/**
 * OrderExecutor.ts
 *
 * Исполнение торговых ордеров через официальный REST API Binance Futures.
 *
 * Для торговых операций используется REST API:
 * - Base URL: https://fapi.binance.com
 * - Документация: https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/New-Order
 *
 * Функциональность:
 * - Открытие позиций (market ордера)
 * - Установка стоп-лосса и тейк-профита
 * - Поддержка dry-run режима (симуляция без реальных сделок)
 * - Интеграция с RiskManager для проверки рисков
 */

// @ts-ignore - встроенный модуль Node.js
import { createHmac } from "crypto";
import axios from "axios";
import { Config } from "./Config";
import { Logger } from "./Logger";
import { RiskManager } from "./RiskManager";
import { TimeSync } from "../utils/timeSync";

export interface TradingSignal {
  side: "BUY" | "SELL";
  size?: number;
  stopLoss?: number;
  takeProfit?: number;
  price?: number;
  [key: string]: any; // Для дополнительных полей
}

interface DryRunPosition {
  id: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: number;
  symbol: string;
}

export class OrderExecutor {
  private logger: Logger;
  private risk: RiskManager;
  private dryRunPositions: Map<string, DryRunPosition> = new Map();
  private positionCounter: number = 0;
  private timeSync: TimeSync;

  constructor(logger: Logger, risk: RiskManager) {
    this.logger = logger;
    this.risk = risk;
    this.timeSync = TimeSync.getInstance(logger);

    // Инициализируем синхронизацию времени при создании OrderExecutor
    this.initializeTimeSync();
  }

  /**
   * Инициализация синхронизации времени с Binance
   */
  private async initializeTimeSync(): Promise<void> {
    try {
      // startAutoSync() уже вызывает синхронизацию при старте, поэтому не нужно вызывать sync() отдельно
      this.timeSync.startAutoSync(); // Автоматическая синхронизация каждый час (включает первую синхронизацию)
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to initialize time sync: ${errorMessage}`);
    }
  }

  /**
   * Получение синхронизированного времени для запросов
   */
  private getTimestamp(): number {
    const offset = this.timeSync.getOffset();
    const offsetSeconds = Math.abs(offset) / 1000;
    
    // Если offset больше 1 секунды или нужна повторная синхронизация, запускаем синхронизацию
    if (offsetSeconds > 1.0 || this.timeSync.needsResync()) {
      // Асинхронно синхронизируем (не блокируем, но запускаем процесс)
      this.timeSync.sync(true).catch(() => {
        // Ошибка уже залогирована в TimeSync
      });
      
      // Предупреждаем, если offset слишком большой
      if (offsetSeconds > 1.0) {
        this.logger.warn(
          `⚠️  Large time offset detected: ${offsetSeconds.toFixed(2)}s. Syncing time...`
        );
      }
    }

    return this.timeSync.getSyncedTime();
  }

  /**
   * Генерация подписи для запроса
   */
  private sign(query: string): string {
    return createHmac("sha256", Config.apiSecret).update(query).digest("hex");
  }

  /**
   * Форматирование quantity для Binance API
   * Убирает лишние нули и ограничивает точность
   */
  private formatQuantity(quantity: number): string {
    // Убираем лишние нули, но сохраняем до 8 знаков после запятой
    return quantity.toString().replace(/\.?0+$/, "");
  }

  /**
   * Исполнение торгового сигнала
   */
  async execute(signal: TradingSignal): Promise<void> {
    // Валидация API ключей для live режима
    if (!Config.dryRun) {
      if (!Config.apiKey || !Config.apiSecret) {
        const errorMsg = 
          `❌ API keys not configured for live trading!\n` +
          `   Current mode: LIVE (dryRun=false)\n` +
          `   To enable live trading, set BINANCE_KEY and BINANCE_SECRET in .env file\n` +
          `   To use simulation mode, set DRY_RUN=true in .env file`;
        this.logger.error(errorMsg);
        throw new Error("API keys not configured for live trading");
      }

      // Проверяем, что API ключи не являются дефолтными (placeholder значения)
      const defaultKeyPattern = /^[A-Za-z0-9]{50,}$/;
      if (
        Config.apiKey.length < 20 ||
        Config.apiSecret.length < 20 ||
        Config.apiKey === "YOUR_API_KEY_HERE" ||
        Config.apiSecret === "YOUR_SECRET_KEY_HERE"
      ) {
        this.logger.warn(
          `⚠️  API keys appear to be placeholder values. ` +
          `Please set real API keys in .env file or enable DRY_RUN mode.`
        );
      }
    }

    if (Config.dryRun) {
      await this.executeDryRun(signal);
      return;
    }

    const positionSide = signal.side === "BUY" ? "LONG" : "SHORT";
    const quantity = signal.size || Config.risk.maxPositionSize; // Используем maxPositionSize как дефолт

    // Валидация размера позиции
    if (quantity <= 0 || quantity > Config.risk.maxPositionSize) {
      throw new Error(
        `Invalid position size: ${quantity}. Max allowed: ${Config.risk.maxPositionSize}`
      );
    }

    this.logger.info(
      `🚀 Executing ${signal.side} order: qty=${quantity}, positionSide=${positionSide}`
    );

    const timestamp = this.getTimestamp();
    const formattedQuantity = this.formatQuantity(quantity);
    // Параметры должны быть в алфавитном порядке для подписи (Binance requirement)
    const params = `positionSide=${positionSide}&quantity=${formattedQuantity}&side=${signal.side}&symbol=${Config.symbol}&timestamp=${timestamp}&type=MARKET`;
    const signature = this.sign(params);

    try {
      const res = await axios.post(
        `https://fapi.binance.com/fapi/v1/order?${params}&signature=${signature}`,
        {},
        {
          headers: {
            "X-MBX-APIKEY": Config.apiKey,
          },
        }
      );

      this.logger.info(
        `✅ Order executed, ID: ${res.data.orderId}, Status: ${res.data.status}`
      );

      // Ставим стоп и тейк если они указаны
      if (signal.stopLoss && signal.takeProfit) {
        await this.placeSLTP(
          quantity,
          signal.stopLoss,
          signal.takeProfit,
          signal.side
        );
      } else {
        this.logger.warn(
          "Stop loss or take profit not set, skipping SL/TP orders"
        );
      }
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.msg || err.message || String(err);
      const errorCode = err.response?.data?.code;
      const requestIp =
        err.response?.data?.requestIp ||
        err.response?.headers?.["x-mbx-used-weight"] ||
        "unknown";

      // Детальная обработка ошибок API
      if (
        errorCode === -2015 ||
        errorMessage.includes("Invalid API-key") ||
        errorMessage.includes("permissions")
      ) {
        // Проверяем, не в dry-run ли мы (хотя это не должно произойти, но на всякий случай)
        const modeInfo = Config.dryRun 
          ? `\n   ⚠️  NOTE: You are in DRY_RUN mode. This error should not occur.\n   Consider setting DRY_RUN=true in .env file to avoid API key issues.\n`
          : `\n   ⚠️  Current mode: LIVE trading (DRY_RUN=false)\n   To use simulation mode, set DRY_RUN=true in .env file\n`;

        this.logger.error(
          `\n` +
            `╔═══════════════════════════════════════════════════════════════╗\n` +
            `║  ❌ API KEY ERROR: Invalid API-key, IP, or permissions      ║\n` +
            `╚═══════════════════════════════════════════════════════════════╝\n` +
            `\n` +
            `Request IP: ${requestIp}\n` +
            `Error Code: ${errorCode || "N/A"}\n` +
            modeInfo +
            `\n` +
            `🔍 Possible causes:\n` +
            `   1. API key is incorrect or expired\n` +
            `   2. Your IP address (${requestIp}) is not whitelisted\n` +
            `   3. API key doesn't have "Enable Futures" permission\n` +
            `   4. API key is for Spot trading, but you need Futures API key\n` +
            `   5. IP restriction is enabled but your IP is not in whitelist\n` +
            `\n` +
            `✅ Solution - Check your API key settings on Binance:\n` +
            `   1. Go to: https://www.binance.com/en/my/settings/api-management\n` +
            `   2. Select your API key (or create new Futures API key)\n` +
            `   3. Enable "Enable Futures" permission (MUST BE ENABLED!)\n` +
            `   4. For IP restriction:\n` +
            `      - Option A: Disable IP restriction (for testing)\n` +
            `      - Option B: Add your IP (${requestIp}) to whitelist\n` +
            `   5. Make sure you're using Futures API key, not Spot API key\n` +
            `\n` +
            `💡 Quick fix: Set DRY_RUN=true in .env file to test without API keys\n` +
            `\n` +
            `⚠️  IMPORTANT: The bot generated a valid signal but cannot execute it!\n` +
            `   Signal: ${signal.side} ${quantity} ${Config.symbol} @ ${
              signal.price?.toFixed(2) || "market price"
            }\n` +
            `   SL: ${signal.stopLoss?.toFixed(2) || "N/A"} | TP: ${
              signal.takeProfit?.toFixed(2) || "N/A"
            }\n`
        );
      } else if (errorCode === -1022) {
        const timeOffset = this.timeSync.getOffset();
        const timeOffsetSecondsNum = timeOffset / 1000;
        const timeOffsetSeconds = timeOffsetSecondsNum.toFixed(2);
        const lastSyncTime = this.timeSync.getLastSyncTime();
        const timeSinceSync = lastSyncTime > 0 ? Date.now() - lastSyncTime : 0;
        const timeSinceSyncMinutes = (timeSinceSync / 1000 / 60).toFixed(1);

        // Логируем query string для отладки (без signature)
        const paramsForLog = params;

        this.logger.error(
          `\n` +
            `╔═══════════════════════════════════════════════════════════════╗\n` +
            `║  ❌ SIGNATURE ERROR: Invalid signature (Code: -1022)        ║\n` +
            `╚═══════════════════════════════════════════════════════════════╝\n` +
            `\n` +
            `🔍 Possible causes:\n` +
            `   1. API secret key is incorrect in .env file\n` +
            `   2. Time synchronization issue (offset: ${
              timeOffsetSecondsNum > 0 ? "+" : ""
            }${timeOffsetSeconds}s)\n` +
            `   3. Request parameters are malformed\n` +
            `\n` +
            `📋 Request details:\n` +
            `   Symbol: ${Config.symbol}\n` +
            `   Side: ${signal.side}\n` +
            `   Quantity: ${quantity}\n` +
            `   Timestamp: ${timestamp}\n` +
            `   Time offset: ${timeOffsetSeconds}s\n` +
            `   Last sync: ${timeSinceSyncMinutes} minutes ago\n` +
            `   Query string: ${paramsForLog}\n` +
            `\n` +
            `✅ Solutions:\n` +
            `   1. Verify BINANCE_SECRET_KEY in .env file is correct\n` +
            `   2. Synchronize system time: w32tm /resync (Windows) or sudo ntpdate -s time.nist.gov (Linux)\n` +
            `   3. Restart the bot to force time synchronization\n` +
            `   4. Check if API secret key has not expired or been regenerated\n`,
          {
            error: err.response?.data || err,
            signal,
            timestamp,
            timeOffset,
            queryString: paramsForLog,
          }
        );
        
        // Пытаемся принудительно синхронизировать время после ошибки
        this.timeSync.sync(true).catch(() => {
          // Ошибка уже залогирована в TimeSync
        });
      } else {
        this.logger.error(`Execution error: ${errorMessage}`, {
          error: err.response?.data || err,
          signal,
        });
      }

      // Не прерываем работу бота из-за ошибки API - просто логируем
      // Пользователь может исправить настройки и бот продолжит работу
      this.logger.warn(
        `⚠️  Bot will continue running, but trades will fail until API key is fixed.`
      );

      // В live режиме не бросаем исключение, чтобы бот продолжал работать
      // В dry-run режиме тоже не бросаем
      // throw err; // Закомментировано - бот продолжит работу
    }
  }

  /**
   * Симуляция исполнения ордера (dry-run режим)
   */
  private async executeDryRun(signal: TradingSignal): Promise<void> {
    const positionSide = signal.side === "BUY" ? "LONG" : "SHORT";
    const quantity = signal.size || Config.risk.maxPositionSize;
    const entryPrice = signal.price || 0;

    this.logger.info(
      `🚀 [DRY RUN] Executing ${signal.side} order: qty=${quantity}, positionSide=${positionSide}`
    );

    // Симулируем задержку исполнения
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.logger.info(
      `✅ [DRY RUN] Order executed: ${signal.side} ${quantity} ${Config.symbol}`
    );

    // Симулируем установку SL/TP
    if (signal.stopLoss && signal.takeProfit) {
      this.logger.info(
        `[DRY RUN] Would set SL=${signal.stopLoss}, TP=${signal.takeProfit}`
      );

      // Сохраняем позицию для отслеживания в DRY RUN
      const positionId = `pos_${++this.positionCounter}_${Date.now()}`;
      const position: DryRunPosition = {
        id: positionId,
        side: signal.side,
        positionSide,
        entryPrice,
        quantity,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        entryTime: Date.now(),
        symbol: Config.symbol,
      };

      this.dryRunPositions.set(positionId, position);
      this.logger.info(
        `📊 [DRY RUN] Position opened: ${positionId} | Entry: ${entryPrice.toFixed(
          2
        )} | SL: ${signal.stopLoss.toFixed(
          2
        )} | TP: ${signal.takeProfit.toFixed(2)}`
      );
    }
  }

  /**
   * Проверка открытых позиций в DRY RUN режиме
   * Вызывается при получении новых рыночных данных
   */
  checkDryRunPositions(
    currentPrice: number,
    high?: number,
    low?: number
  ): void {
    if (!Config.dryRun || this.dryRunPositions.size === 0) {
      return;
    }

    // Используем high/low для более точной проверки (если доступны)
    const checkHigh = high ?? currentPrice;
    const checkLow = low ?? currentPrice;

    for (const [positionId, position] of this.dryRunPositions.entries()) {
      let closed = false;
      let closeReason = "";
      let closePrice = 0;
      let pnl = 0;
      let pnlPercent = 0;

      if (position.positionSide === "LONG") {
        // LONG позиция: проверяем TP (high) и SL (low)
        if (checkHigh >= position.takeProfit) {
          closed = true;
          closeReason = "TAKE PROFIT";
          closePrice = position.takeProfit;
        } else if (checkLow <= position.stopLoss) {
          closed = true;
          closeReason = "STOP LOSS";
          closePrice = position.stopLoss;
        }
      } else {
        // SHORT позиция: проверяем TP (low) и SL (high)
        if (checkLow <= position.takeProfit) {
          closed = true;
          closeReason = "TAKE PROFIT";
          closePrice = position.takeProfit;
        } else if (checkHigh >= position.stopLoss) {
          closed = true;
          closeReason = "STOP LOSS";
          closePrice = position.stopLoss;
        }
      }

      if (closed) {
        // Рассчитываем PnL
        if (position.positionSide === "LONG") {
          pnl = (closePrice - position.entryPrice) * position.quantity;
          pnlPercent =
            ((closePrice - position.entryPrice) / position.entryPrice) * 100;
        } else {
          pnl = (position.entryPrice - closePrice) * position.quantity;
          pnlPercent =
            ((position.entryPrice - closePrice) / position.entryPrice) * 100;
        }

        const duration = Date.now() - position.entryTime;
        const durationMinutes = (duration / 1000 / 60).toFixed(1);

        this.logger.info(
          `[DRY RUN] Position CLOSED: ${positionId} | ${closeReason} | Entry: ${position.entryPrice.toFixed(
            2
          )} | Close: ${closePrice.toFixed(2)} | PnL: ${pnl.toFixed(2)} USDT (${
            pnlPercent > 0 ? "+" : ""
          }${pnlPercent.toFixed(2)}%) | Duration: ${durationMinutes} min`
        );

        // Обновляем дневной PnL в RiskManager
        this.risk.updatePnL(pnl);

        // Удаляем позицию из отслеживания
        this.dryRunPositions.delete(positionId);
      }
    }
  }

  /**
   * Получение статистики открытых позиций в DRY RUN
   */
  getDryRunStats(): {
    openPositions: number;
    positions: DryRunPosition[];
  } {
    return {
      openPositions: this.dryRunPositions.size,
      positions: Array.from(this.dryRunPositions.values()),
    };
  }

  /**
   * Установка стоп-лосса и тейк-профита
   * @param quantity - размер позиции (не используется при closePosition=true, но оставляем для совместимости)
   * @param sl - цена стоп-лосса
   * @param tp - цена тейк-профита
   * @param side - сторона позиции (BUY = LONG, SELL = SHORT)
   */
  async placeSLTP(
    quantity: number,
    sl: number,
    tp: number,
    side: "BUY" | "SELL"
  ): Promise<void> {
    if (Config.dryRun) {
      this.logger.info(
        `[DRY RUN] Would set SL=${sl}, TP=${tp} for ${side} position`
      );
      return;
    }

    this.logger.info(`Setting SL/TP for ${side} position...`);

    const opposite = side === "BUY" ? "SELL" : "BUY";
    const positionSide = side === "BUY" ? "LONG" : "SHORT";
    const timestamp = this.getTimestamp();

    // STOP LOSS - используем STOP_MARKET с closePosition=true
    try {
      // Параметры в алфавитном порядке для подписи
      const formattedSL = this.formatQuantity(sl);
      const paramsSL = `closePosition=true&positionSide=${positionSide}&side=${opposite}&stopPrice=${formattedSL}&symbol=${Config.symbol}&timestamp=${timestamp}&type=STOP_MARKET`;
      const signatureSL = this.sign(paramsSL);

      const resSL = await axios.post(
        `https://fapi.binance.com/fapi/v1/order?${paramsSL}&signature=${signatureSL}`,
        {},
        {
          headers: {
            "X-MBX-APIKEY": Config.apiKey,
          },
        }
      );

      this.logger.info(
        `Stop loss set at ${sl}, OrderID: ${resSL.data.orderId}`
      );
    } catch (e: any) {
      const errorMessage = e.response?.data?.msg || e.message || String(e);
      this.logger.error(`Failed to set SL: ${errorMessage}`, {
        error: e.response?.data || e,
        sl,
      });
      // Не прерываем выполнение, продолжаем с TP
    }

    // TAKE PROFIT - используем TAKE_PROFIT_MARKET с closePosition=true
    try {
      // Используем новый timestamp для TP запроса (чтобы избежать дубликатов)
      const timestampTP = this.getTimestamp();
      // Параметры в алфавитном порядке для подписи
      const formattedTP = this.formatQuantity(tp);
      const paramsTP = `closePosition=true&positionSide=${positionSide}&side=${opposite}&stopPrice=${formattedTP}&symbol=${Config.symbol}&timestamp=${timestampTP}&type=TAKE_PROFIT_MARKET`;
      const signatureTP = this.sign(paramsTP);

      const resTP = await axios.post(
        `https://fapi.binance.com/fapi/v1/order?${paramsTP}&signature=${signatureTP}`,
        {},
        {
          headers: {
            "X-MBX-APIKEY": Config.apiKey,
          },
        }
      );

      this.logger.info(
        `Take profit set at ${tp}, OrderID: ${resTP.data.orderId}`
      );
    } catch (e: any) {
      const errorMessage = e.response?.data?.msg || e.message || String(e);
      this.logger.error(`Failed to set TP: ${errorMessage}`, {
        error: e.response?.data || e,
        tp,
      });
    }
  }

  /**
   * Закрытие позиции
   * @param symbol - символ торговой пары (опционально)
   * @param reason - причина закрытия (опционально)
   * @param positionSide - сторона позиции (LONG/SHORT), если не указана, будет определена автоматически
   */
  async closePosition(
    symbol?: string,
    reason?: string,
    positionSide?: "LONG" | "SHORT"
  ): Promise<void> {
    const symbolToUse = symbol || Config.symbol;
    const reasonToUse = reason || "Manual close";

    if (Config.dryRun) {
      this.logger.info(
        `[DRY RUN] Closing position: ${symbolToUse} (${reasonToUse})`
      );
      return;
    }

    // Валидация API ключей
    if (!Config.apiKey || !Config.apiSecret) {
      throw new Error("API keys not configured");
    }

    this.logger.info(`Closing position: ${symbolToUse} (${reasonToUse})`);

    // Если positionSide не указана, используем closePosition=true (закроет любую позицию)
    // Если указана, используем конкретную сторону
    const timestamp = this.getTimestamp();
    let params: string;

    if (positionSide) {
      // Закрываем конкретную позицию
      const side = positionSide === "LONG" ? "SELL" : "BUY";
      // Параметры в алфавитном порядке для подписи
      params = `closePosition=true&positionSide=${positionSide}&side=${side}&symbol=${symbolToUse}&timestamp=${timestamp}&type=MARKET`;
    } else {
      // Закрываем любую открытую позицию (Binance определит автоматически)
      // Параметры в алфавитном порядке для подписи
      params = `closePosition=true&side=SELL&symbol=${symbolToUse}&timestamp=${timestamp}&type=MARKET`;
    }

    const signature = this.sign(params);

    try {
      const res = await axios.post(
        `https://fapi.binance.com/fapi/v1/order?${params}&signature=${signature}`,
        {},
        {
          headers: {
            "X-MBX-APIKEY": Config.apiKey,
          },
        }
      );

      this.logger.info(
        `Position closed: ${symbolToUse}, OrderID: ${res.data.orderId}`
      );
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.msg || err.message || String(err);
      this.logger.error(`Failed to close position: ${errorMessage}`, {
        error: err.response?.data || err,
        symbol: symbolToUse,
        reason: reasonToUse,
      });
      throw err;
    }
  }
}
