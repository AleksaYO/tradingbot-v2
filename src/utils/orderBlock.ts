/**
 * orderBlock.ts
 * 
 * МОДУЛЬ 4. Order Blocks
 * 
 * Order Block - это свеча, которая вызвала BOS (Break of Structure).
 * Это зона, где крупные игроки (Smart Money) разместили свои ордера.
 * 
 * Правила определения:
 * - Для Bullish BOS: ищем последнюю медвежью свечу (close < open) перед BOS
 * - Для Bearish BOS: ищем последнюю бычью свечу (close > open) перед BOS
 * 
 * Order Blocks используются для:
 * - Определения зон входа
 * - Поиска уровней поддержки/сопротивления
 * - Анализа ликвидности
 */

import { KlineData } from "../types";
import { StructureChange } from "./structure";

export interface OrderBlock {
  type: "bullish" | "bearish";
  index: number;
  open: number;
  close: number;
  high: number;
  low: number;
  timestamp: number;
  kline: KlineData;
  bosIndex: number; // Индекс BOS, который вызвал этот Order Block
  isValid: boolean; // Действителен ли Order Block (не пробит)
}

/**
 * МОДУЛЬ 4. Order Blocks
 * 
 * Определение свечи, которая вызвала BOS.
 * 
 * @param candles - массив свечей (KlineData)
 * @param bos - объект BOS (Break of Structure)
 * @returns Order Block или null, если не найден
 */
export function findOrderBlock(
  candles: KlineData[],
  bos: StructureChange | null
): OrderBlock | null {
  if (!bos) {
    return null;
  }

  if (bos.index < 1 || bos.index >= candles.length) {
    return null; // Некорректный индекс BOS
  }

  // Bullish: ищем последнюю медвежью свечу перед BOS
  if (bos.direction === "bullish") {
    for (let i = bos.index - 1; i >= 0; i--) {
      const candle = candles[i];
      if (candle.close < candle.open) {
        // Медвежья свеча найдена
        return {
          type: "bullish",
          index: i,
          open: candle.open,
          close: candle.close,
          high: candle.high,
          low: candle.low,
          timestamp: candle.closeTime,
          kline: candle,
          bosIndex: bos.index,
          isValid: true,
        };
      }
    }
  }

  // Bearish: ищем последнюю бычью свечу перед BOS
  if (bos.direction === "bearish") {
    for (let i = bos.index - 1; i >= 0; i--) {
      const candle = candles[i];
      if (candle.close > candle.open) {
        // Бычья свеча найдена
        return {
          type: "bearish",
          index: i,
          open: candle.open,
          close: candle.close,
          high: candle.high,
          low: candle.low,
          timestamp: candle.closeTime,
          kline: candle,
          bosIndex: bos.index,
          isValid: true,
        };
      }
    }
  }

  return null;
}

/**
 * Поиск всех Order Blocks для массива BOS
 * 
 * @param candles - массив свечей
 * @param bosArray - массив BOS событий
 * @returns массив Order Blocks
 */
export function findAllOrderBlocks(
  candles: KlineData[],
  bosArray: StructureChange[]
): OrderBlock[] {
  const orderBlocks: OrderBlock[] = [];

  for (const bos of bosArray) {
    const ob = findOrderBlock(candles, bos);
    if (ob) {
      orderBlocks.push(ob);
    }
  }

  return orderBlocks;
}

/**
 * Проверка, пробит ли Order Block
 * 
 * Order Block считается пробитым (недействительным), если:
 * - Для Bullish OB: цена пробила low Order Block вниз
 * - Для Bearish OB: цена пробила high Order Block вверх
 * 
 * @param orderBlock - Order Block для проверки
 * @param currentPrice - текущая цена
 * @param candles - массив свечей для проверки пробития
 * @returns true если Order Block пробит
 */
export function isOrderBlockBroken(
  orderBlock: OrderBlock,
  currentPrice: number,
  candles?: KlineData[]
): boolean {
  if (orderBlock.type === "bullish") {
    // Bullish OB пробит, если цена ушла ниже low
    return currentPrice < orderBlock.low;
  } else {
    // Bearish OB пробит, если цена ушла выше high
    return currentPrice > orderBlock.high;
  }
}

/**
 * Обновление статуса валидности всех Order Blocks
 * 
 * @param orderBlocks - массив Order Blocks
 * @param currentPrice - текущая цена
 * @param candles - массив свечей (опционально)
 * @returns обновленный массив Order Blocks
 */
export function updateOrderBlockValidity(
  orderBlocks: OrderBlock[],
  currentPrice: number,
  candles?: KlineData[]
): OrderBlock[] {
  return orderBlocks.map((ob) => ({
    ...ob,
    isValid: !isOrderBlockBroken(ob, currentPrice, candles),
  }));
}

/**
 * Получение валидных (не пробитых) Order Blocks
 * 
 * @param orderBlocks - массив Order Blocks
 * @param currentPrice - текущая цена
 * @returns только валидные Order Blocks
 */
export function getValidOrderBlocks(
  orderBlocks: OrderBlock[],
  currentPrice: number
): OrderBlock[] {
  return orderBlocks.filter(
    (ob) => !isOrderBlockBroken(ob, currentPrice)
  );
}

/**
 * Получение ближайшего валидного Order Block к текущей цене
 * 
 * @param orderBlocks - массив Order Blocks
 * @param currentPrice - текущая цена
 * @param type - тип Order Block для фильтрации (опционально)
 * @returns ближайший валидный Order Block или null
 */
export function getNearestValidOrderBlock(
  orderBlocks: OrderBlock[],
  currentPrice: number,
  type?: "bullish" | "bearish"
): OrderBlock | null {
  const valid = getValidOrderBlocks(orderBlocks, currentPrice);
  const filtered = type ? valid.filter((ob) => ob.type === type) : valid;

  if (filtered.length === 0) {
    return null;
  }

  // Находим Order Block, центр которого ближе всего к текущей цене
  let nearest: OrderBlock | null = null;
  let minDistance = Infinity;

  for (const ob of filtered) {
    const center = (ob.high + ob.low) / 2;
    const distance = Math.abs(currentPrice - center);

    if (distance < minDistance) {
      minDistance = distance;
      nearest = ob;
    }
  }

  return nearest;
}

/**
 * Проверка, находится ли цена внутри Order Block
 * 
 * @param orderBlock - Order Block
 * @param price - цена для проверки
 * @returns true если цена внутри Order Block
 */
export function isPriceInOrderBlock(
  orderBlock: OrderBlock,
  price: number
): boolean {
  return price >= orderBlock.low && price <= orderBlock.high;
}

/**
 * Получение Order Blocks в определенном ценовом диапазоне
 * 
 * @param orderBlocks - массив Order Blocks
 * @param minPrice - минимальная цена
 * @param maxPrice - максимальная цена
 * @returns Order Blocks в указанном диапазоне
 */
export function getOrderBlocksInRange(
  orderBlocks: OrderBlock[],
  minPrice: number,
  maxPrice: number
): OrderBlock[] {
  return orderBlocks.filter((ob) => {
    // Order Block пересекается с диапазоном, если есть перекрытие
    return ob.high >= minPrice && ob.low <= maxPrice;
  });
}

/**
 * Получение последнего Order Block
 * 
 * @param orderBlocks - массив Order Blocks
 * @returns последний Order Block (с наибольшим индексом) или null
 */
export function getLatestOrderBlock(
  orderBlocks: OrderBlock[]
): OrderBlock | null {
  if (orderBlocks.length === 0) {
    return null;
  }

  return orderBlocks.reduce((latest, current) =>
    current.index > latest.index ? current : latest
  );
}

/**
 * Получение зоны входа на основе Order Block
 * 
 * @param orderBlock - Order Block
 * @returns объект с зоной входа (верхняя и нижняя границы)
 */
export function getOrderBlockEntryZone(orderBlock: OrderBlock): {
  upper: number;
  lower: number;
  center: number;
} {
  return {
    upper: orderBlock.high,
    lower: orderBlock.low,
    center: (orderBlock.high + orderBlock.low) / 2,
  };
}

