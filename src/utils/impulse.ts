/**
 * impulse.ts
 * 
 * Модуль для анализа силы импульса и слабости коррекции.
 * 
 * Функциональность:
 * - Фильтр силы импульса (определение сильных движений)
 * - Фильтр слабости коррекции (определение слабых откатов)
 * - Анализ momentum
 * - Оценка качества движения
 * 
 * Улучшение: Добавлен для повышения качества сигналов SMC
 */

import { KlineData } from "../types";
import { SwingPoint } from "./swing";

export interface ImpulseAnalysis {
  strength: number; // Сила импульса (0-1)
  direction: "bullish" | "bearish" | "neutral";
  momentum: number; // Momentum (скорость движения)
  quality: number; // Общее качество импульса (0-1)
}

export interface CorrectionAnalysis {
  weakness: number; // Слабость коррекции (0-1, выше = слабее коррекция)
  isWeak: boolean; // Является ли коррекция слабой
  retracementPercent: number; // Процент коррекции
}

/**
 * Анализ силы импульса
 * 
 * Улучшение: Оценивает силу импульса на основе:
 * - Размера движения
 * - Объема
 * - Количества свечей
 * - Momentum
 * 
 * @param candles - массив свечей для анализа
 * @param startIndex - начальный индекс
 * @param endIndex - конечный индекс
 * @returns анализ импульса
 */
export function analyzeImpulse(
  candles: KlineData[],
  startIndex: number,
  endIndex: number
): ImpulseAnalysis {
  if (startIndex >= endIndex || endIndex >= candles.length) {
    return {
      strength: 0,
      direction: "neutral",
      momentum: 0,
      quality: 0,
    };
  }

  const startCandle = candles[startIndex];
  const endCandle = candles[endIndex];
  const priceChange = endCandle.close - startCandle.close;
  const priceChangePercent = (priceChange / startCandle.close) * 100;

  // Определяем направление
  const direction: "bullish" | "bearish" | "neutral" =
    priceChangePercent > 0.1 ? "bullish" :
    priceChangePercent < -0.1 ? "bearish" :
    "neutral";

  // Рассчитываем средний объем
  const candlesInMove = candles.slice(startIndex, endIndex + 1);
  const avgVolume = candlesInMove.reduce((sum, c) => sum + c.volume, 0) / candlesInMove.length;
  const overallAvgVolume = candles.slice(-50).reduce((sum, c) => sum + c.volume, 0) / 50;

  // Сила импульса на основе размера движения
  const moveStrength = Math.min(Math.abs(priceChangePercent) / 2, 1); // До 2% = полная сила

  // Сила на основе объема
  const volumeStrength = Math.min(avgVolume / overallAvgVolume / 2, 1); // До 2x среднего = полная сила

  // Momentum (скорость движения)
  const numCandles = endIndex - startIndex + 1;
  const momentum = Math.abs(priceChangePercent) / numCandles; // % изменения на свечу

  // Общая сила импульса
  const strength = (moveStrength * 0.5 + volumeStrength * 0.5);

  // Качество импульса (комбинация всех факторов)
  const quality = Math.min(
    (strength * 0.4 + Math.min(momentum / 0.5, 1) * 0.3 + volumeStrength * 0.3),
    1.0
  );

  return {
    strength,
    direction,
    momentum,
    quality,
  };
}

/**
 * Анализ слабости коррекции
 * 
 * Улучнение: Определяет, является ли коррекция слабой (хороший знак для продолжения тренда)
 * 
 * @param candles - массив свечей
 * @param impulseStart - начало импульса
 * @param impulseEnd - конец импульса
 * @param correctionEnd - конец коррекции
 * @returns анализ коррекции
 */
export function analyzeCorrection(
  candles: KlineData[],
  impulseStart: number,
  impulseEnd: number,
  correctionEnd: number
): CorrectionAnalysis {
  if (impulseStart >= impulseEnd || impulseEnd >= correctionEnd || correctionEnd >= candles.length) {
    return {
      weakness: 0,
      isWeak: false,
      retracementPercent: 0,
    };
  }

  const impulseStartPrice = candles[impulseStart].close;
  const impulseEndPrice = candles[impulseEnd].close;
  const correctionEndPrice = candles[correctionEnd].close;

  const impulseSize = Math.abs(impulseEndPrice - impulseStartPrice);
  const correctionSize = Math.abs(correctionEndPrice - impulseEndPrice);

  // Процент коррекции (Fibonacci retracement)
  const retracementPercent = (correctionSize / impulseSize) * 100;

  // Слабость коррекции (меньше коррекция = слабее = лучше)
  // Коррекция считается слабой, если она меньше 38.2% (первый уровень Фибоначчи)
  const weakness = Math.max(0, 1 - retracementPercent / 38.2);
  const isWeak = retracementPercent < 38.2;

  return {
    weakness,
    isWeak,
    retracementPercent,
  };
}

/**
 * Фильтр силы импульса
 * 
 * Улучшение: Проверяет, достаточно ли силен импульс для входа
 * 
 * @param candles - массив свечей
 * @param swingPoints - массив swing точек
 * @param direction - направление для проверки
 * @param minStrength - минимальная сила импульса (0-1)
 * @returns true если импульс достаточно силен
 */
export function isImpulseStrong(
  candles: KlineData[],
  swingPoints: SwingPoint[],
  direction: "bullish" | "bearish",
  minStrength: number = 0.5
): boolean {
  if (swingPoints.length < 2) {
    return false;
  }

  // Берем последние 2 swing точки соответствующего типа
  const relevantSwings = swingPoints
    .filter((s) => (direction === "bullish" ? s.type === "high" : s.type === "low"))
    .slice(-2);

  if (relevantSwings.length < 2) {
    return false;
  }

  const startSwing = relevantSwings[0];
  const endSwing = relevantSwings[1];

  const analysis = analyzeImpulse(candles, startSwing.index, endSwing.index);

  return analysis.strength >= minStrength && analysis.direction === direction;
}

/**
 * Фильтр слабости коррекции
 * 
 * Улучшение: Проверяет, является ли коррекция слабой (хороший знак)
 * 
 * @param candles - массив свечей
 * @param swingPoints - массив swing точек
 * @param direction - направление тренда
 * @param maxRetracement - максимальный процент коррекции (по умолчанию 50%)
 * @returns true если коррекция слабая
 */
export function isCorrectionWeak(
  candles: KlineData[],
  swingPoints: SwingPoint[],
  direction: "bullish" | "bearish",
  maxRetracement: number = 50
): boolean {
  if (swingPoints.length < 4) {
    return false;
  }

  // Для бычьего тренда: ищем high -> low -> high
  // Для медвежьего тренда: ищем low -> high -> low
  const lastSwings = swingPoints.slice(-4);

  let impulseStart: number | null = null;
  let impulseEnd: number | null = null;
  let correctionEnd: number | null = null;

  if (direction === "bullish") {
    // Ищем паттерн: low -> high -> low -> high
    for (let i = 0; i < lastSwings.length - 2; i++) {
      if (
        lastSwings[i].type === "low" &&
        lastSwings[i + 1].type === "high" &&
        lastSwings[i + 2].type === "low"
      ) {
        impulseStart = lastSwings[i].index;
        impulseEnd = lastSwings[i + 1].index;
        correctionEnd = lastSwings[i + 2].index;
        break;
      }
    }
  } else {
    // Ищем паттерн: high -> low -> high -> low
    for (let i = 0; i < lastSwings.length - 2; i++) {
      if (
        lastSwings[i].type === "high" &&
        lastSwings[i + 1].type === "low" &&
        lastSwings[i + 2].type === "high"
      ) {
        impulseStart = lastSwings[i].index;
        impulseEnd = lastSwings[i + 1].index;
        correctionEnd = lastSwings[i + 2].index;
        break;
      }
    }
  }

  if (!impulseStart || !impulseEnd || !correctionEnd) {
    return false;
  }

  const analysis = analyzeCorrection(candles, impulseStart, impulseEnd, correctionEnd);

  return analysis.isWeak && analysis.retracementPercent <= maxRetracement;
}

/**
 * Комплексный анализ импульса и коррекции
 * 
 * Улучшение: Объединяет анализ импульса и коррекции для оценки качества движения
 * 
 * @param candles - массив свечей
 * @param swingPoints - массив swing точек
 * @param direction - направление для анализа
 * @returns общая оценка качества движения (0-1)
 */
export function analyzeMovementQuality(
  candles: KlineData[],
  swingPoints: SwingPoint[],
  direction: "bullish" | "bearish"
): number {
  const impulseStrong = isImpulseStrong(candles, swingPoints, direction, 0.4);
  const correctionWeak = isCorrectionWeak(candles, swingPoints, direction, 50);

  let quality = 0.5; // Базовая оценка

  if (impulseStrong) {
    quality += 0.25;
  }

  if (correctionWeak) {
    quality += 0.25;
  }

  return Math.min(quality, 1.0);
}

