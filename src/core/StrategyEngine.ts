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
        const price = this.dataFeed.getMidPrice();

        if (!price || candles.length < 10) {
          return null; // Недостаточно данных
        }

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
        return null; // Недостаточно данных
      }

      if (!this.dataFeed) {
        return null; // DataFeed не установлен
      }

      const candles = (this.dataFeed as DataFeed).getKlines(100);
      if (candles.length < 10) {
        return null;
      }

      return this.processWithCandles(candles, price);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in StrategyEngine.process: ${errorMessage}`);
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
      return null; // Недостаточно свечей для анализа
    }

    // Проверяем, была ли обработана последняя свеча
    const lastKline = candles[candles.length - 1];
    if (lastKline && lastKline.closeTime) {
      // Обрабатываем только закрытые свечи или новые свечи
      if (lastKline.closeTime <= this.lastProcessedKlineTime) {
        return null; // Эта свеча уже была обработана
      }
      this.lastProcessedKlineTime = lastKline.closeTime;
    }

    // Используем SMC стратегию
    const smcSignal = smcStrategy(candles, price);

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

      this.logger.info(`SMC signal: ${JSON.stringify(smcSignal)}`);

      // Конвертируем SMCSignal в Signal
      const signal = convertToSignal(smcSignal, Config.symbol);

      // Дополнительная информация для логирования
      this.logger.info(
        `SMC Entry Signal: ${signal.type} @ ${signal.entryPrice.toFixed(2)}, ` +
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
