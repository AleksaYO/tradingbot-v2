/**
 * confirmation.ts
 * 
 * Модуль для подтверждения торговых сигналов.
 * 
 * Функциональность:
 * - Подтверждение свечой (candle confirmation)
 * - Проверка ретеста (retest)
 * - Анализ момента входа
 * - Валидация сигнала перед входом
 * 
 * Улучшение: Добавлен для повышения качества сигналов SMC
 */

import { KlineData } from "../types";
import { OrderBlock } from "./orderBlock";
import { StructureChange } from "./structure";

export interface ConfirmationResult {
  confirmed: boolean; // Подтвержден ли сигнал
  confidence: number; // Уверенность в подтверждении (0-1)
  reason: string; // Причина подтверждения/отклонения
  entryPrice?: number; // Рекомендуемая цена входа
}

export interface RetestInfo {
  detected: boolean; // Обнаружен ли ретест
  retestCandle: KlineData | null; // Свеча ретеста
  retestIndex: number | null; // Индекс свечи ретеста
  quality: number; // Качество ретеста (0-1)
}

/**
 * Подтверждение сигнала свечой
 * 
 * Улучшение: Проверяет, подтверждает ли текущая/последняя свеча сигнал
 * 
 * Правила подтверждения:
 * - Для BUY: свеча должна закрыться выше Order Block или показать бычью структуру
 * - Для SELL: свеча должна закрыться ниже Order Block или показать медвежью структуру
 * 
 * @param signalDirection - направление сигнала
 * @param orderBlock - Order Block
 * @param candles - массив свечей
 * @returns результат подтверждения
 */
export function confirmWithCandle(
  signalDirection: "BUY" | "SELL",
  orderBlock: OrderBlock,
  candles: KlineData[]
): ConfirmationResult {
  if (candles.length === 0) {
    return {
      confirmed: false,
      confidence: 0,
      reason: "No candles available for confirmation",
    };
  }

  const lastCandle = candles[candles.length - 1];
  const obCenter = (orderBlock.high + orderBlock.low) / 2;

  if (signalDirection === "BUY") {
    // Бычий сигнал подтверждается, если:
    // 1. Свеча коснулась Order Block (базовое подтверждение)
    // 2. Свеча закрылась выше центра Order Block
    // 3. Свеча бычья (close > open)
    // 4. Свеча имеет большой бычий body

    const touchedOB = lastCandle.low <= orderBlock.high && lastCandle.high >= orderBlock.low;
    const closedAboveOB = lastCandle.close > obCenter;
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const bodySize = lastCandle.close - lastCandle.open;
    const candleRange = lastCandle.high - lastCandle.low;
    const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;

    let confidence = 0;
    let reasons: string[] = [];

    // Базовое подтверждение: свеча коснулась Order Block
    if (touchedOB) {
      confidence += 0.4; // Увеличено с 0, так как это базовое подтверждение
      reasons.push("candle touched OB");
    }

    if (closedAboveOB) {
      confidence += 0.2; // Снижено с 0.3, так как базовое подтверждение уже есть
      reasons.push("closed above OB center");
    }

    if (isBullishCandle) {
      confidence += 0.2; // Снижено с 0.3
      reasons.push("bullish candle");
    }

    if (bodyRatio > 0.6) {
      confidence += 0.1; // Снижено с 0.2
      reasons.push("strong bullish body");
    }

    if (lastCandle.close > orderBlock.high) {
      confidence += 0.1; // Снижено с 0.2
      reasons.push("closed above OB high");
    }

    return {
      confirmed: confidence >= 0.4, // Снижено с 0.5, так как базовое подтверждение уже дает 0.4
      confidence: Math.min(confidence, 1.0),
      reason: reasons.length > 0 ? reasons.join(", ") : "no confirmation",
      entryPrice: lastCandle.close,
    };
  } else {
    // Медвежий сигнал подтверждается, если:
    // 1. Свеча коснулась Order Block (базовое подтверждение)
    // 2. Свеча закрылась ниже центра Order Block
    // 3. Свеча медвежья (close < open)
    // 4. Свеча имеет большой медвежий body

    const touchedOB = lastCandle.low <= orderBlock.high && lastCandle.high >= orderBlock.low;
    const closedBelowOB = lastCandle.close < obCenter;
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const bodySize = lastCandle.open - lastCandle.close;
    const candleRange = lastCandle.high - lastCandle.low;
    const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;

    let confidence = 0;
    let reasons: string[] = [];

    // Базовое подтверждение: свеча коснулась Order Block
    if (touchedOB) {
      confidence += 0.4; // Увеличено с 0, так как это базовое подтверждение
      reasons.push("candle touched OB");
    }

    if (closedBelowOB) {
      confidence += 0.2; // Снижено с 0.3, так как базовое подтверждение уже есть
      reasons.push("closed below OB center");
    }

    if (isBearishCandle) {
      confidence += 0.2; // Снижено с 0.3
      reasons.push("bearish candle");
    }

    if (bodyRatio > 0.6) {
      confidence += 0.1; // Снижено с 0.2
      reasons.push("strong bearish body");
    }

    if (lastCandle.close < orderBlock.low) {
      confidence += 0.1; // Снижено с 0.2
      reasons.push("closed below OB low");
    }

    return {
      confirmed: confidence >= 0.4, // Снижено с 0.5, так как базовое подтверждение уже дает 0.4
      confidence: Math.min(confidence, 1.0),
      reason: reasons.length > 0 ? reasons.join(", ") : "no confirmation",
      entryPrice: lastCandle.close,
    };
  }
}

/**
 * Обнаружение ретеста Order Block
 * 
 * Улучшение: Определяет, произошел ли ретест Order Block (возврат цены к OB)
 * 
 * @param orderBlock - Order Block
 * @param candles - массив свечей
 * @param startIndex - индекс, с которого начинать поиск (обычно индекс BOS)
 * @returns информация о ретесте
 */
export function detectRetest(
  orderBlock: OrderBlock,
  candles: KlineData[],
  startIndex: number
): RetestInfo {
  // Ищем ретест после BOS (после startIndex)
  for (let i = startIndex + 1; i < candles.length; i++) {
    const candle = candles[i];

    // Проверяем, коснулась ли цена Order Block
    const touchedOB =
      candle.low <= orderBlock.high && candle.high >= orderBlock.low;

    if (touchedOB) {
      // Определяем качество ретеста
      let quality = 0.5;

      // 1. Насколько близко цена подошла к OB
      const obCenter = (orderBlock.high + orderBlock.low) / 2;
      const candleCenter = (candle.high + candle.low) / 2;
      const distanceToCenter = Math.abs(candleCenter - obCenter);
      const obSize = orderBlock.high - orderBlock.low;
      const distanceRatio = distanceToCenter / obSize;

      if (distanceRatio < 0.3) {
        quality += 0.2; // Очень близко к центру
      } else if (distanceRatio < 0.5) {
        quality += 0.1; // Близко к центру
      }

      // 2. Объем при ретесте
      const avgVolume = candles
        .slice(-20)
        .reduce((sum, c) => sum + c.volume, 0) / 20;
      if (candle.volume > avgVolume * 1.5) {
        quality += 0.2; // Высокий объем
      } else if (candle.volume > avgVolume) {
        quality += 0.1; // Средний объем
      }

      // 3. Разворот после ретеста
      if (i < candles.length - 1) {
        const nextCandle = candles[i + 1];
        if (orderBlock.type === "bullish") {
          if (nextCandle.close > candle.close) {
            quality += 0.1; // Разворот вверх
          }
        } else {
          if (nextCandle.close < candle.close) {
            quality += 0.1; // Разворот вниз
          }
        }
      }

      return {
        detected: true,
        retestCandle: candle,
        retestIndex: i,
        quality: Math.min(quality, 1.0),
      };
    }
  }

  return {
    detected: false,
    retestCandle: null,
    retestIndex: null,
    quality: 0,
  };
}

/**
 * Комплексное подтверждение сигнала
 * 
 * Улучшение: Объединяет все методы подтверждения для финальной валидации
 * 
 * @param signalDirection - направление сигнала
 * @param orderBlock - Order Block
 * @param structure - структура (BOS)
 * @param candles - массив свечей
 * @param requireCandleConfirmation - требуется ли подтверждение свечой
 * @param requireRetest - требуется ли ретест
 * @returns результат подтверждения
 */
export function confirmSignal(
  signalDirection: "BUY" | "SELL",
  orderBlock: OrderBlock,
  structure: StructureChange,
  candles: KlineData[],
  requireCandleConfirmation: boolean = true,
  requireRetest: boolean = false
): ConfirmationResult {
  let totalConfidence = 0;
  let reasons: string[] = [];
  let entryPrice: number | undefined;

  // 1. Подтверждение свечой
  const candleConfirmation = confirmWithCandle(
    signalDirection,
    orderBlock,
    candles
  );

  if (requireCandleConfirmation && !candleConfirmation.confirmed) {
    return {
      confirmed: false,
      confidence: 0,
      reason: `Candle confirmation failed: ${candleConfirmation.reason}`,
    };
  }

  totalConfidence += candleConfirmation.confidence * 0.5;
  if (candleConfirmation.confirmed) {
    reasons.push("candle confirmed");
  }
  if (candleConfirmation.entryPrice) {
    entryPrice = candleConfirmation.entryPrice;
  }

  // 2. Проверка ретеста
  const retest = detectRetest(orderBlock, candles, structure.index);

  if (requireRetest && !retest.detected) {
    return {
      confirmed: false,
      confidence: 0,
      reason: "Retest required but not detected",
    };
  }

  if (retest.detected) {
    totalConfidence += retest.quality * 0.3;
    reasons.push(`retest detected (quality: ${(retest.quality * 100).toFixed(0)}%)`);
  } else {
    // Если ретест не требуется, добавляем базовую уверенность
    totalConfidence += 0.1;
  }

  // 3. Проверка структуры (BOS должен быть свежим)
  const structureAge = candles.length - structure.index;
  if (structureAge <= 5) {
    totalConfidence += 0.1;
    reasons.push("fresh BOS");
  } else if (structureAge <= 10) {
    totalConfidence += 0.05;
  }

  // 4. Проверка валидности Order Block
  if (orderBlock.isValid) {
    totalConfidence += 0.1;
    reasons.push("OB valid");
  }

  return {
    confirmed: totalConfidence >= 0.5,
    confidence: Math.min(totalConfidence, 1.0),
    reason: reasons.length > 0 ? reasons.join(", ") : "no confirmation",
    entryPrice: entryPrice || candles[candles.length - 1].close,
  };
}

