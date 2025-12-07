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

/**
 * УЛУЧШЕНИЕ: Фильтрация ложных FVG
 * 
 * Ложные FVG - это маленькие разрывы, которые быстро заполняются или не имеют значения.
 * 
 * @param fvgs - массив FVG
 * @param candles - массив свечей
 * @param minSizePercent - минимальный размер FVG в процентах от средней свечи
 * @returns отфильтрованные FVG
 */
export function filterFalseFVG(
  fvgs: FVGPoint[],
  candles: KlineData[],
  minSizePercent: number = 0.3
): FVGPoint[] {
  if (candles.length < 20) {
    return fvgs;
  }

  // Рассчитываем средний размер свечи
  const avgCandleSize = candles
    .slice(-50)
    .reduce((sum, c) => sum + (c.high - c.low), 0) / Math.min(50, candles.length);

  return fvgs.filter((fvg) => {
    const fvgSize = Math.abs(fvg.start - fvg.end);
    const sizeRatio = fvgSize / avgCandleSize;

    // Фильтруем слишком маленькие FVG
    return sizeRatio >= minSizePercent;
  });
}

/**
 * УЛУЧШЕНИЕ: Расширение FVG (extension)
 * 
 * Расширяет FVG для учета возможных зон возврата цены.
 * 
 * @param fvg - FVG для расширения
 * @param extensionPercent - процент расширения (по умолчанию 20%)
 * @returns расширенный FVG
 */
export function extendFVG(
  fvg: FVGPoint,
  extensionPercent: number = 20
): FVGPoint {
  const fvgSize = Math.abs(fvg.start - fvg.end);
  const extension = fvgSize * (extensionPercent / 100);

  if (fvg.type === "bullish") {
    // Расширяем вверх и вниз
    return {
      ...fvg,
      start: fvg.start + extension, // Расширяем верхнюю границу
      end: fvg.end - extension, // Расширяем нижнюю границу
    };
  } else {
    // Расширяем вверх и вниз
    return {
      ...fvg,
      start: fvg.start - extension, // Расширяем верхнюю границу
      end: fvg.end + extension, // Расширяем нижнюю границу
    };
  }
}

/**
 * УЛУЧШЕНИЕ: Проверка качества FVG
 * 
 * Оценивает качество FVG на основе размера, контекста и объема.
 * 
 * @param fvg - FVG для проверки
 * @param candles - массив свечей
 * @returns оценка качества FVG (0-1)
 */
export function evaluateFVGQuality(
  fvg: FVGPoint,
  candles: KlineData[]
): number {
  let quality = 0.5; // Базовая оценка

  // 1. Размер FVG
  const fvgSize = Math.abs(fvg.start - fvg.end);
  const avgCandleSize = candles
    .slice(-20)
    .reduce((sum, c) => sum + (c.high - c.low), 0) / 20;
  const sizeRatio = fvgSize / avgCandleSize;

  if (sizeRatio >= 0.5 && sizeRatio <= 2.0) {
    quality += 0.2; // Оптимальный размер
  } else if (sizeRatio > 2.0) {
    quality += 0.1; // Слишком большой, но все еще валиден
  }

  // 2. Объем при формировании FVG
  const fvgCandle = fvg.candles.c2; // Средняя свеча
  const avgVolume = candles
    .slice(-20)
    .reduce((sum, c) => sum + c.volume, 0) / 20;
  const volumeRatio = fvgCandle.volume / avgVolume;

  if (volumeRatio > 1.5) {
    quality += 0.2; // Высокий объем
  } else if (volumeRatio > 1.0) {
    quality += 0.1; // Средний объем
  }

  // 3. Контекст (насколько четкий разрыв)
  const c1 = fvg.candles.c1;
  const c3 = fvg.candles.c3;

  if (fvg.type === "bullish") {
    const gapSize = c3.low - c1.high;
    const gapRatio = gapSize / avgCandleSize;
    if (gapRatio > 0.3) {
      quality += 0.1; // Четкий разрыв
    }
  } else {
    const gapSize = c1.low - c3.high;
    const gapRatio = gapSize / avgCandleSize;
    if (gapRatio > 0.3) {
      quality += 0.1; // Четкий разрыв
    }
  }

  return Math.min(quality, 1.0);
}

/**
 * УЛУЧШЕНИЕ: Улучшенный поиск FVG с фильтрацией и оценкой качества
 * 
 * @param candles - массив свечей
 * @param minQuality - минимальное качество FVG (0-1)
 * @param filterFalse - фильтровать ли ложные FVG
 * @returns массив качественных FVG
 */
export function findFVGEnhanced(
  candles: KlineData[],
  minQuality: number = 0.5,
  filterFalse: boolean = true
): FVGPoint[] {
  // Сначала находим базовые FVG
  let fvgs = findFVG(candles);

  // Фильтруем ложные FVG
  if (filterFalse) {
    fvgs = filterFalseFVG(fvgs, candles, 0.3);
  }

  // Фильтруем по качеству
  return fvgs.filter((fvg) => {
    const quality = evaluateFVGQuality(fvg, candles);
    return quality >= minQuality;
  });
}

/**
 * УЛУЧШЕНИЕ: Получение расширенных FVG
 * 
 * Возвращает FVG с расширением для учета зон возврата.
 * 
 * @param fvgs - массив FVG
 * @param extensionPercent - процент расширения
 * @returns массив расширенных FVG
 */
export function getExtendedFVGs(
  fvgs: FVGPoint[],
  extensionPercent: number = 20
): FVGPoint[] {
  return fvgs.map((fvg) => extendFVG(fvg, extensionPercent));
}

/**
 * УЛУЧШЕНИЕ: Проверка, находится ли цена в расширенном FVG
 * 
 * @param fvg - FVG (может быть расширенным)
 * @param price - цена для проверки
 * @param extensionPercent - процент расширения, если FVG не был расширен
 * @returns true если цена в FVG
 */
export function isPriceInExtendedFVG(
  fvg: FVGPoint,
  price: number,
  extensionPercent: number = 20
): boolean {
  const extended = extendFVG(fvg, extensionPercent);
  const fvgMin = Math.min(extended.start, extended.end);
  const fvgMax = Math.max(extended.start, extended.end);

  return price >= fvgMin && price <= fvgMax;
}

