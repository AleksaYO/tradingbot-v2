/**
 * swing.ts
 * 
 * Модуль для определения Swing High и Swing Low на графике свечей.
 * 
 * Swing High - локальный максимум, когда цена выше соседних свечей
 * Swing Low - локальный минимум, когда цена ниже соседних свечей
 * 
 * Используется в техническом анализе для:
 * - Определения структуры рынка (Higher Highs, Lower Lows)
 * - Поиска точек разворота
 * - Построения трендовых линий
 * - Анализа SMC (Smart Money Concept)
 */

import { KlineData } from "../types";

export interface SwingPoint {
  index: number;
  type: "high" | "low";
  price: number;
  timestamp: number;
  kline: KlineData;
}

/**
 * МОДУЛЬ 1. Определение Swing High / Swing Low
 * 
 * @param candles - массив свечей (KlineData)
 * @param lookback - количество свечей для проверки с каждой стороны (по умолчанию 3)
 * @returns массив точек разворота (SwingPoint)
 * 
 * Алгоритм:
 * - Для каждой свечи проверяем, является ли она локальным максимумом/минимумом
 * - Swing High: high текущей свечи выше high всех соседних свечей в диапазоне lookback
 * - Swing Low: low текущей свечи ниже low всех соседних свечей в диапазоне lookback
 */
export function findSwings(
  candles: KlineData[],
  lookback: number = 3
): SwingPoint[] {
  const swings: SwingPoint[] = [];

  if (candles.length < lookback * 2 + 1) {
    return swings; // Недостаточно данных
  }

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const high = current.high;
    const low = current.low;

    let isSwingHigh = true;
    let isSwingLow = true;

    // Проверяем соседние свечи в диапазоне lookback
    for (let j = 1; j <= lookback; j++) {
      const prev = candles[i - j];
      const next = candles[i + j];

      // Проверка Swing High: текущий high должен быть выше всех соседних
      if (prev.high >= high || next.high >= high) {
        isSwingHigh = false;
      }

      // Проверка Swing Low: текущий low должен быть ниже всех соседних
      if (prev.low <= low || next.low <= low) {
        isSwingLow = false;
      }
    }

    // Добавляем Swing High
    if (isSwingHigh) {
      swings.push({
        index: i,
        type: "high",
        price: high,
        timestamp: current.closeTime,
        kline: current,
      });
    }

    // Добавляем Swing Low
    if (isSwingLow) {
      swings.push({
        index: i,
        type: "low",
        price: low,
        timestamp: current.closeTime,
        kline: current,
      });
    }
  }

  return swings;
}

/**
 * Фильтрация Swing точек по силе
 * 
 * @param swings - массив Swing точек
 * @param minStrength - минимальная сила (разница в цене от соседних точек)
 * @returns отфильтрованные Swing точки
 */
export function filterSwingsByStrength(
  swings: SwingPoint[],
  minStrength: number = 0
): SwingPoint[] {
  if (swings.length < 2 || minStrength <= 0) {
    return swings;
  }

  return swings.filter((swing, index) => {
    if (index === 0 || index === swings.length - 1) {
      return true; // Всегда включаем первую и последнюю точку
    }

    const prev = swings[index - 1];
    const next = swings[index + 1];

    if (swing.type === "high") {
      // Для Swing High проверяем разницу с предыдущим и следующим low
      const strength = Math.min(
        swing.price - (prev.type === "low" ? prev.price : prev.kline.low),
        swing.price - (next.type === "low" ? next.price : next.kline.low)
      );
      return strength >= minStrength;
    } else {
      // Для Swing Low проверяем разницу с предыдущим и следующим high
      const strength = Math.min(
        (prev.type === "high" ? prev.price : prev.kline.high) - swing.price,
        (next.type === "high" ? next.price : next.kline.high) - swing.price
      );
      return strength >= minStrength;
    }
  });
}

/**
 * Получение последних Swing High и Swing Low
 * 
 * @param swings - массив Swing точек
 * @returns объект с последними Swing High и Swing Low
 */
export function getLatestSwings(swings: SwingPoint[]): {
  latestHigh: SwingPoint | null;
  latestLow: SwingPoint | null;
} {
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  return {
    latestHigh: highs.length > 0 ? highs[highs.length - 1] : null,
    latestLow: lows.length > 0 ? lows[lows.length - 1] : null,
  };
}

/**
 * Определение структуры рынка на основе Swing точек
 * 
 * @param swings - массив Swing точек
 * @returns структура рынка: "UPTREND", "DOWNTREND", "RANGE", "UNKNOWN"
 */
export function determineMarketStructure(swings: SwingPoint[]): string {
  if (swings.length < 4) {
    return "UNKNOWN";
  }

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  if (highs.length < 2 || lows.length < 2) {
    return "UNKNOWN";
  }

  // Берем последние 2 High и 2 Low
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);

  const higherHigh = lastHighs[1].price > lastHighs[0].price;
  const higherLow = lastLows[1].price > lastLows[0].price;
  const lowerHigh = lastHighs[1].price < lastHighs[0].price;
  const lowerLow = lastLows[1].price < lastLows[0].price;

  // Восходящий тренд: Higher Highs и Higher Lows
  if (higherHigh && higherLow) {
    return "UPTREND";
  }

  // Нисходящий тренд: Lower Highs и Lower Lows
  if (lowerHigh && lowerLow) {
    return "DOWNTREND";
  }

  // Боковик: смешанная структура
  return "RANGE";
}

