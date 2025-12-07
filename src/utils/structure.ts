/**
 * structure.ts
 *
 * Модуль для определения смены структуры рынка:
 * - BOS (Break of Structure) - пробитие структуры
 * - CHoCH (Change of Character) - смена характера движения
 *
 * Используется в стратегии SMC для определения точек входа и смены тренда.
 */

import { SwingPoint } from "./swing";
import { KlineData } from "../types";

export interface StructureChange {
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  index: number;
  price: number;
  timestamp: number;
  previousSwing: SwingPoint;
  currentSwing: SwingPoint;
}

/**
 * МОДУЛЬ 3. BOS и CHoCH
 *
 * Определение смены структуры рынка на основе Swing точек.
 *
 * BOS (Break of Structure):
 * - Bullish BOS: новый swing high выше предыдущего swing high
 * - Bearish BOS: новый swing low ниже предыдущего swing low
 *
 * CHoCH (Change of Character):
 * - Смена структуры с восходящей на нисходящую или наоборот
 * - Происходит когда после серии higher highs появляется lower low (или наоборот)
 *
 * @param swings - массив Swing точек
 * @returns объект с информацией о смене структуры или null
 */
export function detectStructure(swings: SwingPoint[]): StructureChange | null {
  if (swings.length < 4) {
    return null;
  }

  const last = swings.slice(-4);
  const s1 = last[0];
  const s2 = last[1];
  const s3 = last[2];
  const s4 = last[3];

  // Bullish BOS: новый swing high выше предыдущего swing high
  if (s3.type === "high" && s4.type === "high" && s4.price > s3.price) {
    return {
      type: "BOS",
      direction: "bullish",
      index: s4.index,
      price: s4.price,
      timestamp: s4.timestamp,
      previousSwing: s3,
      currentSwing: s4,
    };
  }

  // Bearish BOS: новый swing low ниже предыдущего swing low
  if (s3.type === "low" && s4.type === "low" && s4.price < s3.price) {
    return {
      type: "BOS",
      direction: "bearish",
      index: s4.index,
      price: s4.price,
      timestamp: s4.timestamp,
      previousSwing: s3,
      currentSwing: s4,
    };
  }

  return null;
}

/**
 * Определение CHoCH (Change of Character)
 *
 * CHoCH происходит когда:
 * - После серии higher highs появляется lower low (медвежий CHoCH)
 * - После серии lower lows появляется higher high (бычий CHoCH)
 *
 * @param swings - массив Swing точек
 * @returns объект с информацией о CHoCH или null
 */
export function detectCHoCH(swings: SwingPoint[]): StructureChange | null {
  if (swings.length < 4) {
    return null;
  }

  const last = swings.slice(-4);
  const s1 = last[0];
  const s2 = last[1];
  const s3 = last[2];
  const s4 = last[3];

  // Бычий CHoCH: после lower lows появляется higher high
  if (
    s1.type === "low" &&
    s2.type === "low" &&
    s2.price < s1.price && // Lower lows
    s3.type === "high" &&
    s4.type === "high" &&
    s4.price > s3.price // Higher high
  ) {
    return {
      type: "CHoCH",
      direction: "bullish",
      index: s4.index,
      price: s4.price,
      timestamp: s4.timestamp,
      previousSwing: s3,
      currentSwing: s4,
    };
  }

  // Медвежий CHoCH: после higher highs появляется lower low
  if (
    s1.type === "high" &&
    s2.type === "high" &&
    s2.price > s1.price && // Higher highs
    s3.type === "low" &&
    s4.type === "low" &&
    s4.price < s3.price // Lower low
  ) {
    return {
      type: "CHoCH",
      direction: "bearish",
      index: s4.index,
      price: s4.price,
      timestamp: s4.timestamp,
      previousSwing: s3,
      currentSwing: s4,
    };
  }

  return null;
}

/**
 * Комбинированная функция для определения всех типов смены структуры
 *
 * @param swings - массив Swing точек
 * @returns массив всех обнаруженных изменений структуры
 */
export function detectAllStructureChanges(
  swings: SwingPoint[]
): StructureChange[] {
  const changes: StructureChange[] = [];

  // Проверяем BOS
  const bos = detectStructure(swings);
  if (bos) {
    changes.push(bos);
  }

  // Проверяем CHoCH
  const choch = detectCHoCH(swings);
  if (choch) {
    changes.push(choch);
  }

  return changes;
}

/**
 * Получение последнего изменения структуры
 *
 * @param swings - массив Swing точек
 * @returns последнее обнаруженное изменение структуры или null
 */
export function getLatestStructureChange(
  swings: SwingPoint[]
): StructureChange | null {
  const changes = detectAllStructureChanges(swings);
  if (changes.length === 0) {
    return null;
  }

  // Возвращаем последнее изменение (с наибольшим индексом)
  return changes.reduce((latest, current) =>
    current.index > latest.index ? current : latest
  );
}

/**
 * Проверка, является ли текущая структура восходящей
 *
 * @param swings - массив Swing точек
 * @returns true если структура восходящая (higher highs и higher lows)
 */
export function isUptrendStructure(swings: SwingPoint[]): boolean {
  if (swings.length < 4) {
    return false;
  }

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  if (highs.length < 2 || lows.length < 2) {
    return false;
  }

  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);

  return (
    lastHighs[1].price > lastHighs[0].price &&
    lastLows[1].price > lastLows[0].price
  );
}

/**
 * Проверка, является ли текущая структура нисходящей
 *
 * @param swings - массив Swing точек
 * @returns true если структура нисходящая (lower highs и lower lows)
 */
export function isDowntrendStructure(swings: SwingPoint[]): boolean {
  if (swings.length < 4) {
    return false;
  }

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  if (highs.length < 2 || lows.length < 2) {
    return false;
  }

  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);

  return (
    lastHighs[1].price < lastHighs[0].price &&
    lastLows[1].price < lastLows[0].price
  );
}

/**
 * УЛУЧШЕНИЕ: Фильтр силы импульса для BOS
 *
 * Проверяет, достаточно ли силен импульс для валидного BOS.
 * Учитывает объем и размер движения.
 *
 * @param structure - структура BOS
 * @param candles - массив свечей
 * @param minImpulseStrength - минимальная сила импульса (0-1)
 * @returns true если импульс достаточно силен
 */
export function isBOSImpulseStrong(
  structure: StructureChange,
  candles: KlineData[],
  minImpulseStrength: number = 0.5
): boolean {
  if (structure.index >= candles.length) {
    return false;
  }

  // Анализируем свечи между предыдущим и текущим swing
  const startIndex = structure.previousSwing.index;
  const endIndex = structure.currentSwing.index;

  if (startIndex >= endIndex || endIndex >= candles.length) {
    return false;
  }

  const moveCandles = candles.slice(startIndex, endIndex + 1);
  const priceChange = Math.abs(
    structure.currentSwing.price - structure.previousSwing.price
  );
  const priceChangePercent =
    (priceChange / structure.previousSwing.price) * 100;

  // Рассчитываем средний объем
  const avgVolume =
    moveCandles.reduce((sum, c) => sum + c.volume, 0) / moveCandles.length;
  const overallAvgVolume =
    candles.slice(-50).reduce((sum, c) => sum + c.volume, 0) /
    Math.min(50, candles.length);

  // Сила импульса на основе размера движения
  const moveStrength = Math.min(priceChangePercent / 1.0, 1.0); // 1% = полная сила

  // Сила на основе объема
  const volumeStrength = Math.min(avgVolume / overallAvgVolume / 1.5, 1.0);

  // Общая сила импульса
  const impulseStrength = moveStrength * 0.6 + volumeStrength * 0.4;

  return impulseStrength >= minImpulseStrength;
}

/**
 * УЛУЧШЕНИЕ: Проверка на sweep ликвидности перед BOS
 *
 * Sweep ликвидности - это когда цена пробивает уровень, но затем быстро разворачивается.
 * Это признак манипуляции Smart Money и усиливает BOS.
 *
 * @param structure - структура BOS
 * @param candles - массив свечей
 * @returns true если обнаружен sweep перед BOS
 */
export function hasLiquiditySweepBeforeBOS(
  structure: StructureChange,
  candles: KlineData[]
): boolean {
  if (structure.index < 3 || structure.index >= candles.length) {
    return false;
  }

  // Проверяем свечи перед BOS
  const beforeBOS = candles.slice(
    Math.max(0, structure.index - 5),
    structure.index
  );

  if (structure.direction === "bullish") {
    // Для бычьего BOS ищем sweep low (пробой low с последующим разворотом вверх)
    for (let i = 0; i < beforeBOS.length - 1; i++) {
      const candle = beforeBOS[i];
      const nextCandle = beforeBOS[i + 1];

      // Проверяем, был ли пробой low с разворотом
      if (
        candle.low < structure.previousSwing.price &&
        nextCandle.close > candle.close &&
        nextCandle.close > structure.previousSwing.price
      ) {
        return true; // Обнаружен sweep low
      }
    }
  } else {
    // Для медвежьего BOS ищем sweep high (пробой high с последующим разворотом вниз)
    for (let i = 0; i < beforeBOS.length - 1; i++) {
      const candle = beforeBOS[i];
      const nextCandle = beforeBOS[i + 1];

      // Проверяем, был ли пробой high с разворотом
      if (
        candle.high > structure.previousSwing.price &&
        nextCandle.close < candle.close &&
        nextCandle.close < structure.previousSwing.price
      ) {
        return true; // Обнаружен sweep high
      }
    }
  }

  return false;
}

/**
 * УЛУЧШЕНИЕ: Улучшенная детекция BOS с фильтрами
 *
 * Включает проверку силы импульса и sweep ликвидности.
 *
 * @param swings - массив swing точек
 * @param candles - массив свечей
 * @param requireStrongImpulse - требовать ли сильный импульс
 * @param requireSweep - требовать ли sweep ликвидности
 * @returns улучшенная структура BOS или null
 */
export function detectStructureEnhanced(
  swings: SwingPoint[],
  candles: KlineData[],
  requireStrongImpulse: boolean = false,
  requireSweep: boolean = false
): StructureChange | null {
  // Сначала используем базовую детекцию
  const baseStructure = detectStructure(swings);

  if (!baseStructure) {
    return null;
  }

  // Проверяем силу импульса
  if (requireStrongImpulse) {
    if (!isBOSImpulseStrong(baseStructure, candles, 0.4)) {
      return null; // Импульс недостаточно силен
    }
  }

  // Проверяем sweep ликвидности
  if (requireSweep) {
    if (!hasLiquiditySweepBeforeBOS(baseStructure, candles)) {
      return null; // Sweep не обнаружен
    }
  }

  return baseStructure;
}

/**
 * УЛУЧШЕНИЕ: Детекция BOS с большим контекстом
 *
 * Анализирует больше swing точек для более точной детекции.
 *
 * @param swings - массив swing точек
 * @param minContextSwings - минимальное количество swing точек для анализа
 * @returns структура BOS или null
 */
export function detectStructureWithContext(
  swings: SwingPoint[],
  minContextSwings: number = 6
): StructureChange | null {
  if (swings.length < minContextSwings) {
    return null;
  }

  // Анализируем последние swing точки с большим контекстом
  const last = swings.slice(-minContextSwings);

  // Ищем паттерн BOS в последних swing точках
  for (let i = last.length - 2; i >= 1; i--) {
    const prevSwing = last[i - 1];
    const currentSwing = last[i];
    const nextSwing = last[i + 1];

    // Bullish BOS: новый swing high выше предыдущего
    if (
      prevSwing.type === "high" &&
      currentSwing.type === "high" &&
      currentSwing.price > prevSwing.price
    ) {
      return {
        type: "BOS",
        direction: "bullish",
        index: currentSwing.index,
        price: currentSwing.price,
        timestamp: currentSwing.timestamp,
        previousSwing: prevSwing,
        currentSwing: currentSwing,
      };
    }

    // Bearish BOS: новый swing low ниже предыдущего
    if (
      prevSwing.type === "low" &&
      currentSwing.type === "low" &&
      currentSwing.price < prevSwing.price
    ) {
      return {
        type: "BOS",
        direction: "bearish",
        index: currentSwing.index,
        price: currentSwing.price,
        timestamp: currentSwing.timestamp,
        previousSwing: prevSwing,
        currentSwing: currentSwing,
      };
    }
  }

  return null;
}

/**
 * УЛУЧШЕНИЕ: Валидация качества BOS
 *
 * Оценивает качество BOS на основе различных факторов.
 *
 * @param structure - структура BOS
 * @param candles - массив свечей
 * @param swings - массив swing точек
 * @returns оценка качества BOS (0-1)
 */
export function validateBOSQuality(
  structure: StructureChange,
  candles: KlineData[],
  swings: SwingPoint[]
): number {
  let quality = 0.5; // Базовая оценка

  // 1. Сила импульса
  if (isBOSImpulseStrong(structure, candles, 0.3)) {
    quality += 0.2;
  }

  // 2. Sweep ликвидности
  if (hasLiquiditySweepBeforeBOS(structure, candles)) {
    quality += 0.15;
  }

  // 3. Размер движения
  const moveSize = Math.abs(
    structure.currentSwing.price - structure.previousSwing.price
  );
  const priceRange =
    Math.max(...swings.map((s) => s.price)) -
    Math.min(...swings.map((s) => s.price));
  const moveRatio = moveSize / priceRange;
  if (moveRatio > 0.1) {
    quality += 0.15; // Большое движение
  }

  // 4. Свежесть BOS (не слишком старый)
  const bosAge = candles.length - structure.index;
  if (bosAge <= 5) {
    quality += 0.1; // Свежий BOS
  }

  return Math.min(quality, 1.0);
}
