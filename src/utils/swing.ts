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

/**
 * УЛУЧШЕНИЕ: Анализ объема для swing точек
 * 
 * Определяет силу swing точки на основе объема.
 * Сильные swing точки обычно имеют высокий объем.
 * 
 * @param swing - swing точка
 * @param candles - массив свечей
 * @param lookback - количество свечей для расчета среднего объема
 * @returns сила swing точки на основе объема (0-1)
 */
export function getSwingVolumeStrength(
  swing: SwingPoint,
  candles: KlineData[],
  lookback: number = 20
): number {
  const swingVolume = swing.kline.volume;
  const startIndex = Math.max(0, swing.index - lookback);
  const endIndex = Math.min(candles.length, swing.index + lookback);
  const avgVolume = candles
    .slice(startIndex, endIndex)
    .reduce((sum, c) => sum + c.volume, 0) / (endIndex - startIndex);

  if (avgVolume === 0) {
    return 0.5; // Базовая оценка, если нет данных
  }

  const volumeRatio = swingVolume / avgVolume;
  // Нормализуем: 1x = 0.5, 2x = 0.75, 3x+ = 1.0
  return Math.min(0.5 + (volumeRatio - 1) * 0.25, 1.0);
}

/**
 * УЛУЧШЕНИЕ: Анализ фитилей (wick) для определения силы swing
 * 
 * Большие фитили на swing точках указывают на сильное сопротивление/поддержку.
 * 
 * @param swing - swing точка
 * @returns сила swing на основе фитилей (0-1)
 */
export function getSwingWickStrength(swing: SwingPoint): number {
  const candle = swing.kline;
  const bodySize = Math.abs(candle.close - candle.open);
  const candleRange = candle.high - candle.low;

  if (candleRange === 0) {
    return 0.5;
  }

  if (swing.type === "high") {
    // Для swing high важен верхний фитиль
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const wickRatio = upperWick / candleRange;
    // Большой верхний фитиль = сильный swing high
    return Math.min(wickRatio * 2, 1.0);
  } else {
    // Для swing low важен нижний фитиль
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const wickRatio = lowerWick / candleRange;
    // Большой нижний фитиль = сильный swing low
    return Math.min(wickRatio * 2, 1.0);
  }
}

/**
 * УЛУЧШЕНИЕ: Адаптивный lookback на основе волатильности
 * 
 * В высоковолатильном рынке нужен больший lookback для фильтрации шума.
 * 
 * @param candles - массив свечей
 * @param baseLookback - базовый lookback (по умолчанию 3)
 * @returns адаптивный lookback
 */
export function getAdaptiveLookback(
  candles: KlineData[],
  baseLookback: number = 3
): number {
  if (candles.length < 20) {
    return baseLookback;
  }

  // Рассчитываем среднюю волатильность (ATR-like)
  const recentCandles = candles.slice(-20);
  const volatilities = recentCandles.map((c) => c.high - c.low);
  const avgVolatility = volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length;
  const overallAvgVolatility = candles
    .slice(-100)
    .map((c) => c.high - c.low)
    .reduce((sum, v) => sum + v, 0) / Math.min(100, candles.length);

  // Если текущая волатильность выше средней, увеличиваем lookback
  const volatilityRatio = avgVolatility / overallAvgVolatility;
  if (volatilityRatio > 1.5) {
    return baseLookback + 1; // Высокая волатильность
  } else if (volatilityRatio < 0.7) {
    return Math.max(2, baseLookback - 1); // Низкая волатильность
  }

  return baseLookback;
}

/**
 * УЛУЧШЕНИЕ: Улучшенный поиск swing точек с анализом объема и фитилей
 * 
 * @param candles - массив свечей
 * @param lookback - количество свечей для проверки (опционально, будет адаптивным)
 * @param minVolumeStrength - минимальная сила объема (0-1)
 * @param minWickStrength - минимальная сила фитиля (0-1)
 * @returns массив swing точек с улучшенной фильтрацией
 */
export function findSwingsEnhanced(
  candles: KlineData[],
  lookback?: number,
  minVolumeStrength: number = 0.3,
  minWickStrength: number = 0.2
): SwingPoint[] {
  // Используем адаптивный lookback, если не указан
  const adaptiveLookback = lookback || getAdaptiveLookback(candles, 3);

  // Сначала находим базовые swing точки
  const baseSwings = findSwings(candles, adaptiveLookback);

  // Фильтруем по объему и фитилям
  return baseSwings.filter((swing) => {
    const volumeStrength = getSwingVolumeStrength(swing, candles);
    const wickStrength = getSwingWickStrength(swing);

    return volumeStrength >= minVolumeStrength || wickStrength >= minWickStrength;
  });
}

/**
 * УЛУЧШЕНИЕ: Обновление high/low для анализа ликвидности
 * 
 * Отслеживает актуальные максимумы и минимумы для определения уровней ликвидности.
 * 
 * @param candles - массив свечей
 * @param lookback - количество свечей для анализа
 * @returns объект с текущими high/low и их индексами
 */
export function updateLiquidityHighLow(
  candles: KlineData[],
  lookback: number = 20
): {
  currentHigh: number;
  currentLow: number;
  highIndex: number;
  lowIndex: number;
} {
  if (candles.length === 0) {
    return {
      currentHigh: 0,
      currentLow: 0,
      highIndex: -1,
      lowIndex: -1,
    };
  }

  const recentCandles = candles.slice(-lookback);
  let currentHigh = recentCandles[0].high;
  let currentLow = recentCandles[0].low;
  let highIndex = candles.length - lookback;
  let lowIndex = candles.length - lookback;

  for (let i = 0; i < recentCandles.length; i++) {
    const candle = recentCandles[i];
    const actualIndex = candles.length - lookback + i;

    if (candle.high > currentHigh) {
      currentHigh = candle.high;
      highIndex = actualIndex;
    }

    if (candle.low < currentLow) {
      currentLow = candle.low;
      lowIndex = actualIndex;
    }
  }

  return {
    currentHigh,
    currentLow,
    highIndex,
    lowIndex,
  };
}

/**
 * УЛУЧШЕНИЕ: Комплексная оценка силы swing точки
 * 
 * Объединяет анализ объема, фитилей и ценового движения.
 * 
 * @param swing - swing точка
 * @param candles - массив свечей
 * @returns общая сила swing точки (0-1)
 */
export function getSwingOverallStrength(
  swing: SwingPoint,
  candles: KlineData[]
): number {
  const volumeStrength = getSwingVolumeStrength(swing, candles);
  const wickStrength = getSwingWickStrength(swing);

  // Взвешенная оценка: объем 40%, фитиль 40%, базовая сила 20%
  const overallStrength = volumeStrength * 0.4 + wickStrength * 0.4 + 0.2;

  return Math.min(overallStrength, 1.0);
}

/**
 * УЛУЧШЕНИЕ: Фильтрация swing точек по комплексной силе
 * 
 * @param swings - массив swing точек
 * @param candles - массив свечей
 * @param minStrength - минимальная общая сила (0-1)
 * @returns отфильтрованные swing точки
 */
export function filterSwingsByOverallStrength(
  swings: SwingPoint[],
  candles: KlineData[],
  minStrength: number = 0.5
): SwingPoint[] {
  return swings.filter((swing) => {
    const strength = getSwingOverallStrength(swing, candles);
    return strength >= minStrength;
  });
}

