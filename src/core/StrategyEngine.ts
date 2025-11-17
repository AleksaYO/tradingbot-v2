/**
 * StrategyEngine.ts
 *
 * Движок торговых стратегий - координирует работу различных стратегий.
 *
 * Функциональность:
 * - Получение данных от DataFeed
 * - Запуск анализа через выбранную стратегию (например, SMC из strategies/smc.ts)
 * - Агрегация сигналов от разных стратегий (если используется несколько)
 * - Фильтрация и валидация торговых сигналов
 * - Передача сигналов в OrderExecutor для исполнения
 *
 * Архитектура:
 * - Использует паттерн Strategy для поддержки различных торговых стратегий
 * - Каждая стратегия реализует общий интерфейс анализа
 * - StrategyEngine может использовать одну или несколько стратегий одновременно
 *
 * Методы:
 * - process() - основной метод анализа, возвращает Signal | null
 * - setStrategy() - установка активной стратегии
 * - getStrategyState() - получение состояния стратегии (для отладки)
 */

import { Logger } from "./Logger";
import { DataFeed } from "./DataFeed";
import { smcStrategy, convertToSignal } from "../strategies/smc";
import { Signal } from "../types";
import { Config } from "./Config";

export class StrategyEngine {
  private logger: Logger;
  private dataFeed: DataFeed | null = null;
  private lastProcessedKlineTime: number = 0;
  private lastSignalHash: string = "";

  constructor(logger: Logger, dataFeed?: DataFeed) {
    this.logger = logger;
    this.dataFeed = dataFeed || null;
  }

  /**
   * Установка DataFeed для доступа к свечам и ценам
   */
  setDataFeed(dataFeed: DataFeed): void {
    this.dataFeed = dataFeed;
  }

  /**
   * Обработка рыночных данных и генерация торговых сигналов
   *
   * @param data - данные от DataFeed (может быть KlineData, AggTradeData, DepthData или объект с candles и price)
   * @returns торговый сигнал или null
   */
  process(data: any): Signal | null {
    try {
      // Если data уже содержит candles и price (из handleMarketData)
      if (data && data.candles && typeof data.price === "number") {
        return this.processWithCandles(data.candles, data.price);
      }

      // Если передан DataFeed, получаем данные из него
      if (this.dataFeed) {
        const candles = this.dataFeed.getKlines(100); // Получаем последние 100 свечей
        let price = this.dataFeed.getMidPrice();

        // Если price не доступен из order book, используем цену из последней свечи или из переданных данных
        if (!price) {
          if (candles.length > 0) {
            price = candles[candles.length - 1].close;
          } else if (data && typeof data.close === "number") {
            price = data.close;
          } else if (data && typeof data.price === "number") {
            price = data.price;
          }
        }

        if (!price || candles.length < 10) {
          this.logger.debug(
            `Not enough data for analysis: price=${price}, candles=${candles.length}`
          );
          return null; // Недостаточно данных
        }

        this.logger.debug(
          `Processing with DataFeed: candles=${candles.length}, price=${price.toFixed(2)}`
        );

        return this.processWithCandles(candles, price);
      }

      // Fallback: пытаемся извлечь цену из данных
      let price: number | null = null;
      if (data && typeof data.price === "number") {
        price = data.price;
      } else if (data && typeof data.close === "number") {
        price = data.close;
      }

      if (!price) {
        this.logger.debug("No price found in data");
        return null; // Недостаточно данных
      }

      if (!this.dataFeed) {
        this.logger.error("DataFeed not set");
        return null; // DataFeed не установлен
      }

      const candles = (this.dataFeed as DataFeed).getKlines(100);
      if (candles.length < 10) {
        this.logger.debug(`Not enough candles: ${candles.length} < 10`);
        return null;
      }

      return this.processWithCandles(candles, price);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in StrategyEngine.process: ${errorMessage}`, {
        error: error instanceof Error ? error.stack : String(error),
      });
      return null;
    }
  }

  /**
   * Обработка данных с использованием SMC стратегии
   *
   * @param candles - массив свечей
   * @param price - текущая цена
   * @returns торговый сигнал или null
   */
  private processWithCandles(candles: any[], price: number): Signal | null {
    if (!candles || candles.length < 10) {
      this.logger.debug(
        `Not enough candles for analysis: ${candles?.length || 0} < 10`
      );
      return null; // Недостаточно свечей для анализа
    }

    // Проверяем, была ли обработана последняя свеча
    const lastKline = candles[candles.length - 1];
    if (lastKline && lastKline.closeTime) {
      // Обрабатываем только закрытые свечи или новые свечи
      if (lastKline.closeTime <= this.lastProcessedKlineTime) {
        this.logger.debug(
          `Skipping already processed candle: closeTime=${lastKline.closeTime}, lastProcessed=${this.lastProcessedKlineTime}`
        );
        return null; // Эта свеча уже была обработана
      }
      this.lastProcessedKlineTime = lastKline.closeTime;
      // Логируем только периодически, чтобы не создавать спам
      if (Math.random() < 0.1) { // 10% шанс логирования
        this.logger.debug(
          `🔍 Analyzing new candle: closeTime=${new Date(lastKline.closeTime).toLocaleTimeString()}, price=${price.toFixed(2)}, candles=${candles.length}`
        );
      }
    } else {
      // Если нет closeTime, все равно логируем
      this.logger.debug(
        `Processing candle without closeTime: price=${price.toFixed(2)}, candles=${candles.length}`
      );
    }

    // Используем SMC стратегию (логируем только на уровне DEBUG и периодически)
    if (Math.random() < 0.05) { // 5% шанс логирования
      this.logger.debug(
        `🔍 Running SMC strategy: candles=${candles.length}, price=${price.toFixed(2)}`
      );
    }
    
    const smcSignal = smcStrategy(candles, price, this.logger);

    if (!smcSignal) {
      // Логируем периодически для диагностики
      if (Math.random() < 0.2) { // 20% шанс логирования для лучшей диагностики
        this.logger.debug(
          `⚠️ No SMC signal generated. Price: ${price.toFixed(2)}, Candles: ${candles.length}. ` +
          `Possible reasons: no BOS, no Order Block, price not in Order Block, or Order Block invalid.`
        );
      }
      return null;
    }

    if (smcSignal) {
      // Создаем хеш сигнала для защиты от дубликатов
      const signalHash = `${smcSignal.side}-${smcSignal.entry.toFixed(
        2
      )}-${smcSignal.stop.toFixed(2)}`;
      if (signalHash === this.lastSignalHash) {
        this.logger.debug("Duplicate signal ignored");
        return null;
      }
      this.lastSignalHash = signalHash;

      this.logger.info(`🎯 SMC signal detected: ${JSON.stringify(smcSignal)}`);

      // Конвертируем SMCSignal в Signal
      const signal = convertToSignal(smcSignal, Config.symbol);

      // Дополнительная информация для логирования
      this.logger.info(
        `🎯 SMC Entry Signal: ${signal.type} @ ${signal.entryPrice.toFixed(2)}, ` +
          `SL: ${signal.stopLoss.toFixed(2)}, TP: ${signal.takeProfit.toFixed(
            2
          )}, ` +
          `Confidence: ${(signal.confidence * 100).toFixed(1)}%`
      );

      return signal;
    }

    return null;
  }
}
