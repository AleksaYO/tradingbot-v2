import { Config } from "./Config";
import { Logger } from "./Logger";
import { Signal } from "../types";

/**
 * RiskManager.ts
 *
 * Управление рисками и контроль торговых операций.
 *
 * Функциональность:
 * - Проверка возможности открытия новой позиции
 * - Расчет размера позиции на основе риска
 * - Контроль максимального убытка за день
 * - Валидация стоп-лоссов и тейк-профитов
 * - Отслеживание дневного PnL
 *
 * Правила управления рисками:
 * - Максимальный размер позиции (из конфигурации)
 * - Максимальный убыток за день (из конфигурации)
 * - Валидация стоп-лоссов и тейк-профитов
 */

export class RiskManager {
  private logger: Logger;
  private dailyLoss: number = 0;
  private dailyStartTime: number = Date.now();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Валидация торгового сигнала
   * @param signal - торговый сигнал для валидации
   * @returns Валидированный сигнал с добавленными стоп-лоссом и тейк-профитом, или null если сигнал отклонен
   */
  validateSignal(signal: Signal | any): Signal | null {
    // Автоматический сброс дневного убытка при необходимости
    this.resetDailyLoss();

    if (!signal) {
      this.logger.warn("Empty signal received");
      return null;
    }

    // 1. Лимит дневного убытка
    if (this.dailyLoss <= -Config.risk.maxDailyLoss) {
      this.logger.error(
        `Daily loss limit reached: ${this.dailyLoss} <= -${Config.risk.maxDailyLoss}`
      );
      return null;
    }

    // 2. Контроль максимального размера позиции
    // В реальности надо запрашивать баланс и размер позиции через Binance API
    // Пока пропускаем, но создаём структуру под это:
    if (signal.size && signal.size > Config.risk.maxPositionSize) {
      this.logger.error(
        `Position too large: ${signal.size} > ${Config.risk.maxPositionSize}`
      );
      return null;
    }

    // 3. Добавляем стоп и тейк на основе цены входа
    const entryPrice = signal.entryPrice || signal.price;
    if (!entryPrice || entryPrice <= 0) {
      this.logger.error("Invalid entry price in signal");
      return null;
    }

    // Определяем направление позиции
    const isLong = signal.type === "LONG" || signal.side === "BUY";

    // Создаем новый объект вместо мутации входного
    const validatedSignal: Signal = {
      type: signal.type || (isLong ? "LONG" : "SHORT"),
      symbol: signal.symbol || Config.symbol,
      entryPrice: entryPrice,
      stopLoss: isLong
        ? entryPrice * (1 - Config.risk.stopLossPercent / 100)
        : entryPrice * (1 + Config.risk.stopLossPercent / 100),
      takeProfit: isLong
        ? entryPrice * (1 + Config.risk.takeProfitPercent / 100)
        : entryPrice * (1 - Config.risk.takeProfitPercent / 100),
      confidence: signal.confidence || 0.5,
      reason: signal.reason || "Signal validated by RiskManager",
    };

    // Если в сигнале уже были SL/TP, используем их (но проверяем валидность)
    if (signal.stopLoss && signal.stopLoss > 0) {
      const isValidSL = isLong
        ? signal.stopLoss < entryPrice
        : signal.stopLoss > entryPrice;
      if (isValidSL) {
        validatedSignal.stopLoss = signal.stopLoss;
      }
    }

    if (signal.takeProfit && signal.takeProfit > 0) {
      const isValidTP = isLong
        ? signal.takeProfit > entryPrice
        : signal.takeProfit < entryPrice;
      if (isValidTP) {
        validatedSignal.takeProfit = signal.takeProfit;
      }
    }

    this.logger.debug(
      `Signal validated: ${validatedSignal.type} @ ${entryPrice}, SL: ${validatedSignal.stopLoss}, TP: ${validatedSignal.takeProfit}`
    );

    return validatedSignal;
  }

  /**
   * Обновление дневного PnL
   * @param pnl - прибыль/убыток (положительное значение = прибыль, отрицательное = убыток)
   */
  updatePnL(pnl: number): void {
    this.dailyLoss += pnl;
    this.logger.info(`Daily PnL updated: ${this.dailyLoss.toFixed(2)}`);

    // Проверяем лимит после обновления
    if (this.dailyLoss <= -Config.risk.maxDailyLoss) {
      this.logger.error(
        `Daily loss limit reached after PnL update: ${this.dailyLoss} <= -${Config.risk.maxDailyLoss}`
      );
    }
  }

  /**
   * Получение текущего дневного убытка
   */
  getDailyLoss(): number {
    return this.dailyLoss;
  }

  /**
   * Сброс дневного убытка (вызывается при начале нового дня)
   */
  resetDailyLoss(): void {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (now - this.dailyStartTime >= oneDay) {
      this.dailyLoss = 0;
      this.dailyStartTime = now;
      this.logger.info("Daily loss counter reset");
    }
  }

  /**
   * Проверка возможности открытия новой позиции
   */
  canOpenPosition(): boolean {
    if (this.dailyLoss <= -Config.risk.maxDailyLoss) {
      this.logger.warn("Cannot open position: daily loss limit reached");
      return false;
    }
    return true;
  }
}
