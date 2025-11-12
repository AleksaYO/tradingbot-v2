/**
 * fvg.ts
 * 
 * МОДУЛЬ 2. Fair Value Gaps (FVG)
 * 
 * Fair Value Gap - это ценовой разрыв между свечами, который возникает когда:
 * - Свеча 1 не перекрывает свечу 3 (между ними есть разрыв)
 * 
 * FVG используется в стратегии SMC для:
 * - Поиска зон, куда цена может вернуться (заполнение гэпа)
 * - Определения точек входа
 * - Анализа ликвидности
 * 
 * Типы FVG:
 * - Bullish FVG: когда c1.high < c3.low (бычий разрыв вверх)
 * - Bearish FVG: когда c1.low > c3.high (медвежий разрыв вниз)
 */

import { KlineData } from "../types";
import { FVG } from "../types";

export interface FVGPoint {
  type: "bullish" | "bearish";
  start: number; // Верхняя граница FVG
  end: number; // Нижняя граница FVG
  index: number; // Индекс свечи, на которой обнаружен FVG
  timestamp: number;
  filled: boolean; // Заполнен ли FVG
  candles: {
    c1: KlineData; // Первая свеча
    c2: KlineData; // Средняя свеча
    c3: KlineData; // Третья свеча
  };
}

/**
 * МОДУЛЬ 2. Fair Value Gaps (FVG)
 * 
 * Правило: FVG есть, когда свеча 1 не перекрывает свечу 3.
 * 
 * @param candles - массив свечей (KlineData)
 * @returns массив обнаруженных FVG
 */
export function findFVG(candles: KlineData[]): FVGPoint[] {
  const fvg: FVGPoint[] = [];

  if (candles.length < 3) {
    return fvg; // Недостаточно данных
  }

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    // Bullish FVG: c1.high < c3.low (бычий разрыв вверх)
    // Это означает, что между свечой 1 и свечой 3 есть разрыв вверх
    if (c1.high < c3.low) {
      fvg.push({
        type: "bullish",
        start: c3.low, // Нижняя граница FVG (low третьей свечи)
        end: c1.high, // Верхняя граница FVG (high первой свечи)
        index: i,
        timestamp: c3.closeTime,
        filled: false,
        candles: { c1, c2, c3 },
      });
    }

    // Bearish FVG: c1.low > c3.high (медвежий разрыв вниз)
    // Это означает, что между свечой 1 и свечой 3 есть разрыв вниз
    if (c1.low > c3.high) {
      fvg.push({
        type: "bearish",
        start: c1.low, // Верхняя граница FVG (low первой свечи)
        end: c3.high, // Нижняя граница FVG (high третьей свечи)
        index: i,
        timestamp: c3.closeTime,
        filled: false,
        candles: { c1, c2, c3 },
      });
    }
  }

  return fvg;
}

/**
 * Проверка, заполнен ли FVG текущей ценой
 * 
 * @param fvg - объект FVG
 * @param currentPrice - текущая цена
 * @returns true если FVG заполнен
 */
export function isFVGFilled(fvg: FVGPoint, currentPrice: number): boolean {
  if (fvg.type === "bullish") {
    // Bullish FVG заполняется, когда цена возвращается в диапазон
    return currentPrice >= fvg.end && currentPrice <= fvg.start;
  } else {
    // Bearish FVG заполняется, когда цена возвращается в диапазон
    return currentPrice >= fvg.end && currentPrice <= fvg.start;
  }
}

/**
 * Обновление статуса заполнения всех FVG
 * 
 * @param fvgs - массив FVG
 * @param currentPrice - текущая цена
 * @returns обновленный массив FVG с флагом filled
 */
export function updateFVGFilledStatus(
  fvgs: FVGPoint[],
  currentPrice: number
): FVGPoint[] {
  return fvgs.map((fvg) => ({
    ...fvg,
    filled: isFVGFilled(fvg, currentPrice) || fvg.filled, // Если уже заполнен, остается заполненным
  }));
}

/**
 * Получение незаполненных FVG
 * 
 * @param fvgs - массив FVG
 * @returns только незаполненные FVG
 */
export function getUnfilledFVG(fvgs: FVGPoint[]): FVGPoint[] {
  return fvgs.filter((fvg) => !fvg.filled);
}

/**
 * Получение ближайшего незаполненного FVG к текущей цене
 * 
 * @param fvgs - массив FVG
 * @param currentPrice - текущая цена
 * @param type - тип FVG для фильтрации (опционально)
 * @returns ближайший незаполненный FVG или null
 */
export function getNearestUnfilledFVG(
  fvgs: FVGPoint[],
  currentPrice: number,
  type?: "bullish" | "bearish"
): FVGPoint | null {
  const unfilled = getUnfilledFVG(fvgs);
  const filtered = type
    ? unfilled.filter((fvg) => fvg.type === type)
    : unfilled;

  if (filtered.length === 0) {
    return null;
  }

  // Находим FVG, центр которого ближе всего к текущей цене
  let nearest: FVGPoint | null = null;
  let minDistance = Infinity;

  for (const fvg of filtered) {
    const center = (fvg.start + fvg.end) / 2;
    const distance = Math.abs(currentPrice - center);

    if (distance < minDistance) {
      minDistance = distance;
      nearest = fvg;
    }
  }

  return nearest;
}

/**
 * Получение FVG в определенном ценовом диапазоне
 * 
 * @param fvgs - массив FVG
 * @param minPrice - минимальная цена
 * @param maxPrice - максимальная цена
 * @returns FVG в указанном диапазоне
 */
export function getFVGInRange(
  fvgs: FVGPoint[],
  minPrice: number,
  maxPrice: number
): FVGPoint[] {
  return fvgs.filter((fvg) => {
    const fvgMin = Math.min(fvg.start, fvg.end);
    const fvgMax = Math.max(fvg.start, fvg.end);
    // FVG пересекается с диапазоном, если есть перекрытие
    return fvgMax >= minPrice && fvgMin <= maxPrice;
  });
}

/**
 * Конвертация FVGPoint в формат FVG из types.ts
 * 
 * @param fvg - объект FVGPoint
 * @returns объект FVG
 */
export function toFVGType(fvg: FVGPoint): FVG {
  return {
    high: Math.max(fvg.start, fvg.end),
    low: Math.min(fvg.start, fvg.end),
    type: fvg.type === "bullish" ? "BULLISH" : "BEARISH",
    timestamp: fvg.timestamp,
    filled: fvg.filled,
  };
}

