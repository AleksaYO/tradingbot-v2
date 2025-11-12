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

export interface TradingSignal {
  side: "BUY" | "SELL";
  size?: number;
  stopLoss?: number;
  takeProfit?: number;
  price?: number;
  [key: string]: any; // Для дополнительных полей
}

export class OrderExecutor {
  private logger: Logger;
  private risk: RiskManager;

  constructor(logger: Logger, risk: RiskManager) {
    this.logger = logger;
    this.risk = risk;
  }

  /**
   * Генерация подписи для запроса
   */
  private sign(query: string): string {
    return createHmac("sha256", Config.apiSecret).update(query).digest("hex");
  }

  /**
   * Исполнение торгового сигнала
   */
  async execute(signal: TradingSignal): Promise<void> {
    // Валидация API ключей для live режима
    if (!Config.dryRun && (!Config.apiKey || !Config.apiSecret)) {
      throw new Error("API keys not configured for live trading");
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
      `Executing ${signal.side} order: qty=${quantity}, positionSide=${positionSide}`
    );

    const timestamp = Date.now();
    const params = `symbol=${Config.symbol}&side=${signal.side}&type=MARKET&quantity=${quantity}&positionSide=${positionSide}&timestamp=${timestamp}`;
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
        `Order executed, ID: ${res.data.orderId}, Status: ${res.data.status}`
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
      this.logger.error(`Execution error: ${errorMessage}`, {
        error: err.response?.data || err,
        signal,
      });
      throw err;
    }
  }

  /**
   * Симуляция исполнения ордера (dry-run режим)
   */
  private async executeDryRun(signal: TradingSignal): Promise<void> {
    const positionSide = signal.side === "BUY" ? "LONG" : "SHORT";
    const quantity = signal.size || Config.risk.maxPositionSize;

    this.logger.info(
      `[DRY RUN] Executing ${signal.side} order: qty=${quantity}, positionSide=${positionSide}`
    );

    // Симулируем задержку исполнения
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.logger.info(
      `[DRY RUN] Order executed: ${signal.side} ${quantity} ${Config.symbol}`
    );

    // Симулируем установку SL/TP
    if (signal.stopLoss && signal.takeProfit) {
      this.logger.info(
        `[DRY RUN] Would set SL=${signal.stopLoss}, TP=${signal.takeProfit}`
      );
    }
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
    const timestamp = Date.now();

    // STOP LOSS - используем STOP_MARKET с closePosition=true
    try {
      const paramsSL = `symbol=${Config.symbol}&side=${opposite}&type=STOP_MARKET&stopPrice=${sl}&closePosition=true&positionSide=${positionSide}&timestamp=${timestamp}`;
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
      const paramsTP = `symbol=${
        Config.symbol
      }&side=${opposite}&type=TAKE_PROFIT_MARKET&stopPrice=${tp}&closePosition=true&positionSide=${positionSide}&timestamp=${
        timestamp + 1
      }`;
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
    const timestamp = Date.now();
    let params: string;

    if (positionSide) {
      // Закрываем конкретную позицию
      const side = positionSide === "LONG" ? "SELL" : "BUY";
      params = `symbol=${symbolToUse}&side=${side}&type=MARKET&closePosition=true&positionSide=${positionSide}&timestamp=${timestamp}`;
    } else {
      // Закрываем любую открытую позицию (Binance определит автоматически)
      params = `symbol=${symbolToUse}&side=SELL&type=MARKET&closePosition=true&timestamp=${timestamp}`;
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
