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

