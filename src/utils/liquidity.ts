/**
 * liquidity.ts
 * 
 * Модуль для анализа ликвидности на основе Smart Money Concepts.
 * 
 * Функциональность:
 * - Обновление high/low для отслеживания ликвидности
 * - Определение sweep'ов (liquidity grab)
 * - Анализ ликвидности по уровням
 * - Проверка пробоев ликвидности
 * 
 * Улучшение: Добавлен для повышения качества сигналов SMC
 */

import { KlineData } from "../types";
import { SwingPoint } from "./swing";

export interface LiquidityLevel {
  price: number;
  type: "high" | "low";
  index: number;
  timestamp: number;
  swept: boolean; // Был ли уровень "сметен" (swept)
  sweepIndex?: number; // Индекс свечи, которая сметала уровень
}

export interface LiquiditySweep {
  level: LiquidityLevel;
  sweepCandle: KlineData;
  sweepIndex: number;
  direction: "bullish" | "bearish"; // Направление sweep'а
}

/**
 * Обновление уровней ликвидности (high/low) на основе новых swing точек
 * 
 * Улучшение: Отслеживает актуальные уровни ликвидности для анализа sweep'ов
 * 
 * @param currentLevels - текущие уровни ликвидности
 * @param swings - массив swing точек
 * @param candles - массив свечей
 * @returns обновленные уровни ликвидности
 */
export function updateLiquidityLevels(
  currentLevels: LiquidityLevel[],
  swings: SwingPoint[],
  candles: KlineData[]
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [...currentLevels];

  // Обновляем уровни на основе последних swing точек
  for (const swing of swings.slice(-5)) { // Берем последние 5 swing точек
    const existingLevel = levels.find(
      (l) => l.type === swing.type && Math.abs(l.price - swing.price) < 0.01
    );

    if (!existingLevel) {
      // Добавляем новый уровень
      levels.push({
        price: swing.price,
        type: swing.type,
        index: swing.index,
        timestamp: swing.timestamp,
        swept: false,
      });
    } else {
      // Обновляем существующий уровень, если новый swing более свежий
      if (swing.index > existingLevel.index) {
        existingLevel.index = swing.index;
        existingLevel.timestamp = swing.timestamp;
      }
    }
  }

  // Удаляем старые уровни (старше 50 свечей)
  const recentLevels = levels.filter((level) => {
    const levelAge = candles.length - level.index;
    return levelAge <= 50;
  });

  return recentLevels;
}

/**
 * Определение sweep'ов ликвидности (liquidity grab)
 * 
 * Улучшение: Sweep происходит, когда цена пробивает уровень ликвидности,
 * но затем быстро разворачивается. Это признак манипуляции Smart Money.
 * 
 * @param levels - уровни ликвидности
 * @param candles - массив свечей
 * @param lookback - количество свечей для проверки после пробоя
 * @returns массив обнаруженных sweep'ов
 */
export function detectLiquiditySweeps(
  levels: LiquidityLevel[],
  candles: KlineData[],
  lookback: number = 3
): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];

  for (const level of levels) {
    if (level.swept) {
      continue; // Уровень уже был сметен
    }

    // Проверяем свечи после уровня
    for (let i = level.index + 1; i < candles.length && i <= level.index + lookback; i++) {
      const candle = candles[i];

      if (level.type === "high") {
        // Sweep high: цена пробила high, но затем закрылась ниже
        if (candle.high > level.price && candle.close < level.price) {
          sweeps.push({
            level,
            sweepCandle: candle,
            sweepIndex: i,
            direction: "bearish", // Медвежий sweep (сметает high)
          });
          level.swept = true;
          level.sweepIndex = i;
          break;
        }
      } else {
        // Sweep low: цена пробила low, но затем закрылась выше
        if (candle.low < level.price && candle.close > level.price) {
          sweeps.push({
            level,
            sweepCandle: candle,
            sweepIndex: i,
            direction: "bullish", // Бычий sweep (сметает low)
          });
          level.swept = true;
          level.sweepIndex = i;
          break;
        }
      }
    }
  }

  return sweeps;
}

/**
 * Проверка, был ли уровень ликвидности сметен (swept)
 * 
 * @param level - уровень ликвидности
 * @param candles - массив свечей
 * @param lookback - количество свечей для проверки
 * @returns true если уровень был сметен
 */
export function isLiquiditySwept(
  level: LiquidityLevel,
  candles: KlineData[],
  lookback: number = 3
): boolean {
  if (level.swept) {
    return true;
  }

  for (let i = level.index + 1; i < candles.length && i <= level.index + lookback; i++) {
    const candle = candles[i];

    if (level.type === "high") {
      if (candle.high > level.price && candle.close < level.price) {
        return true;
      }
    } else {
      if (candle.low < level.price && candle.close > level.price) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Получение ближайших уровней ликвидности к текущей цене
 * 
 * @param levels - уровни ликвидности
 * @param currentPrice - текущая цена
 * @param maxDistance - максимальное расстояние для поиска
 * @returns ближайшие уровни ликвидности
 */
export function getNearestLiquidityLevels(
  levels: LiquidityLevel[],
  currentPrice: number,
  maxDistance?: number
): {
  nearestHigh: LiquidityLevel | null;
  nearestLow: LiquidityLevel | null;
} {
  const highs = levels.filter((l) => l.type === "high" && !l.swept);
  const lows = levels.filter((l) => l.type === "low" && !l.swept);

  let nearestHigh: LiquidityLevel | null = null;
  let nearestLow: LiquidityLevel | null = null;
  let minHighDistance = Infinity;
  let minLowDistance = Infinity;

  for (const high of highs) {
    const distance = high.price - currentPrice; // Расстояние выше цены
    if (distance >= 0 && distance < minHighDistance) {
      if (!maxDistance || distance <= maxDistance) {
        minHighDistance = distance;
        nearestHigh = high;
      }
    }
  }

  for (const low of lows) {
    const distance = currentPrice - low.price; // Расстояние ниже цены
    if (distance >= 0 && distance < minLowDistance) {
      if (!maxDistance || distance <= maxDistance) {
        minLowDistance = distance;
        nearestLow = low;
      }
    }
  }

  return { nearestHigh, nearestLow };
}

/**
 * Анализ качества sweep'а
 * 
 * Улучшение: Оценивает качество sweep'а на основе:
 * - Силы разворота после sweep'а
 * - Объема при sweep'е
 * - Размера фитиля (wick)
 * 
 * @param sweep - sweep ликвидности
 * @param candles - массив свечей
 * @returns оценка качества от 0 до 1
 */
export function evaluateSweepQuality(
  sweep: LiquiditySweep,
  candles: KlineData[]
): number {
  let quality = 0.5; // Базовая оценка

  const sweepCandle = sweep.sweepCandle;
  const avgVolume = candles
    .slice(-20)
    .reduce((sum, c) => sum + c.volume, 0) / 20;

  // 1. Объем при sweep'е (больше объем = лучше)
  const volumeRatio = sweepCandle.volume / avgVolume;
  if (volumeRatio > 1.5) {
    quality += 0.2;
  } else if (volumeRatio > 1.0) {
    quality += 0.1;
  }

  // 2. Размер фитиля (wick) - большой фитиль = сильный sweep
  if (sweep.direction === "bullish") {
    const wickSize = sweepCandle.close - sweepCandle.low;
    const bodySize = Math.abs(sweepCandle.close - sweepCandle.open);
    if (wickSize > bodySize * 2) {
      quality += 0.2; // Большой нижний фитиль
    }
  } else {
    const wickSize = sweepCandle.high - sweepCandle.close;
    const bodySize = Math.abs(sweepCandle.close - sweepCandle.open);
    if (wickSize > bodySize * 2) {
      quality += 0.2; // Большой верхний фитиль
    }
  }

  // 3. Сила разворота после sweep'а
  if (sweep.sweepIndex < candles.length - 1) {
    const nextCandle = candles[sweep.sweepIndex + 1];
    if (sweep.direction === "bullish") {
      if (nextCandle.close > sweepCandle.close) {
        quality += 0.1; // Разворот вверх после sweep'а
      }
    } else {
      if (nextCandle.close < sweepCandle.close) {
        quality += 0.1; // Разворот вниз после sweep'а
      }
    }
  }

  return Math.min(quality, 1.0);
}

