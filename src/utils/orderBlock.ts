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

/**
 * УЛУЧШЕНИЕ: Анализ объема при формировании Order Block
 * 
 * Order Block с высоким объемом более значим.
 * 
 * @param orderBlock - Order Block
 * @param candles - массив свечей
 * @param lookback - количество свечей для расчета среднего объема
 * @returns сила Order Block на основе объема (0-1)
 */
export function getOrderBlockVolumeStrength(
  orderBlock: OrderBlock,
  candles: KlineData[],
  lookback: number = 20
): number {
  const obVolume = orderBlock.kline.volume;
  const startIndex = Math.max(0, orderBlock.index - lookback);
  const endIndex = Math.min(candles.length, orderBlock.index + lookback);
  const avgVolume = candles
    .slice(startIndex, endIndex)
    .reduce((sum, c) => sum + c.volume, 0) / (endIndex - startIndex);

  if (avgVolume === 0) {
    return 0.5;
  }

  const volumeRatio = obVolume / avgVolume;
  // Нормализуем: 1x = 0.5, 2x = 0.75, 3x+ = 1.0
  return Math.min(0.5 + (volumeRatio - 1) * 0.25, 1.0);
}

/**
 * УЛУЧШЕНИЕ: Анализ фитилей (wick) для refined Order Block
 * 
 * Большие фитили на Order Block указывают на сильное сопротивление/поддержку.
 * 
 * @param orderBlock - Order Block
 * @returns сила Order Block на основе фитилей (0-1)
 */
export function getOrderBlockWickStrength(orderBlock: OrderBlock): number {
  const candle = orderBlock.kline;
  const bodySize = Math.abs(candle.close - candle.open);
  const candleRange = candle.high - candle.low;

  if (candleRange === 0) {
    return 0.5;
  }

  if (orderBlock.type === "bullish") {
    // Для бычьего OB важен нижний фитиль
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const wickRatio = lowerWick / candleRange;
    return Math.min(wickRatio * 2, 1.0);
  } else {
    // Для медвежьего OB важен верхний фитиль
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const wickRatio = upperWick / candleRange;
    return Math.min(wickRatio * 2, 1.0);
  }
}

/**
 * УЛУЧШЕНИЕ: Проверка на mitigation (уточнение Order Block)
 * 
 * Mitigation происходит, когда цена частично заполняет OB, но не пробивает его полностью.
 * Это уточняет границы OB.
 * 
 * @param orderBlock - Order Block
 * @param candles - массив свечей
 * @param startIndex - индекс, с которого начинать проверку (обычно индекс BOS)
 * @returns информация о mitigation
 */
export function detectMitigation(
  orderBlock: OrderBlock,
  candles: KlineData[],
  startIndex: number
): {
  detected: boolean;
  mitigatedLow?: number;
  mitigatedHigh?: number;
  mitigationIndex?: number;
} {
  // Ищем свечи после BOS, которые частично заполнили OB
  for (let i = startIndex + 1; i < candles.length; i++) {
    const candle = candles[i];

    // Проверяем, коснулась ли цена OB, но не пробила его полностью
    const touchedOB = candle.low <= orderBlock.high && candle.high >= orderBlock.low;

    if (touchedOB) {
      if (orderBlock.type === "bullish") {
        // Для бычьего OB mitigation происходит, если цена не пробила low
        if (candle.low >= orderBlock.low && candle.low < orderBlock.high) {
          return {
            detected: true,
            mitigatedLow: Math.max(candle.low, orderBlock.low),
            mitigatedHigh: orderBlock.high,
            mitigationIndex: i,
          };
        }
      } else {
        // Для медвежьего OB mitigation происходит, если цена не пробила high
        if (candle.high <= orderBlock.high && candle.high > orderBlock.low) {
          return {
            detected: true,
            mitigatedLow: orderBlock.low,
            mitigatedHigh: Math.min(candle.high, orderBlock.high),
            mitigationIndex: i,
          };
        }
      }
    }
  }

  return { detected: false };
}

/**
 * УЛУЧШЕНИЕ: Создание refined Order Block с учетом mitigation
 * 
 * @param orderBlock - исходный Order Block
 * @param candles - массив свечей
 * @param bosIndex - индекс BOS
 * @returns refined Order Block или исходный, если mitigation не обнаружен
 */
export function refineOrderBlock(
  orderBlock: OrderBlock,
  candles: KlineData[],
  bosIndex: number
): OrderBlock {
  const mitigation = detectMitigation(orderBlock, candles, bosIndex);

  if (!mitigation.detected || !mitigation.mitigatedLow || !mitigation.mitigatedHigh) {
    return orderBlock;
  }

  // Создаем refined OB с уточненными границами
  return {
    ...orderBlock,
    low: mitigation.mitigatedLow,
    high: mitigation.mitigatedHigh,
  };
}

/**
 * УЛУЧШЕНИЕ: Валидация качества Order Block
 * 
 * Оценивает качество OB на основе объема, фитилей и контекста.
 * 
 * @param orderBlock - Order Block
 * @param candles - массив свечей
 * @returns оценка качества OB (0-1)
 */
export function validateOrderBlockQuality(
  orderBlock: OrderBlock,
  candles: KlineData[]
): number {
  let quality = 0.5; // Базовая оценка

  // 1. Объем
  const volumeStrength = getOrderBlockVolumeStrength(orderBlock, candles);
  quality += volumeStrength * 0.3;

  // 2. Фитили
  const wickStrength = getOrderBlockWickStrength(orderBlock);
  quality += wickStrength * 0.2;

  // 3. Размер OB (меньше = лучше, но не слишком маленький)
  const obSize = orderBlock.high - orderBlock.low;
  const avgCandleSize = candles
    .slice(-20)
    .reduce((sum, c) => sum + (c.high - c.low), 0) / 20;
  const sizeRatio = obSize / avgCandleSize;

  if (sizeRatio >= 0.5 && sizeRatio <= 2.0) {
    quality += 0.2; // Оптимальный размер
  } else if (sizeRatio < 0.5) {
    quality += 0.1; // Слишком маленький
  }

  // 4. Свежесть OB
  const obAge = candles.length - orderBlock.index;
  if (obAge <= 10) {
    quality += 0.1; // Свежий OB
  } else if (obAge <= 20) {
    quality += 0.05;
  }

  // 5. Валидность
  if (orderBlock.isValid) {
    quality += 0.1;
  }

  return Math.min(quality, 1.0);
}

/**
 * УЛУЧШЕНИЕ: Улучшенный поиск Order Block с анализом качества
 * 
 * @param candles - массив свечей
 * @param bos - объект BOS
 * @param minQuality - минимальное качество OB (0-1)
 * @returns Order Block или null
 */
export function findOrderBlockEnhanced(
  candles: KlineData[],
  bos: StructureChange | null,
  minQuality: number = 0.5
): OrderBlock | null {
  const baseOB = findOrderBlock(candles, bos);

  if (!baseOB) {
    return null;
  }

  // Проверяем качество
  const quality = validateOrderBlockQuality(baseOB, candles);
  if (quality < minQuality) {
    return null; // Качество недостаточно
  }

  // Применяем mitigation для уточнения
  const refinedOB = refineOrderBlock(baseOB, candles, bos?.index || 0);

  return refinedOB;
}

/**
 * УЛУЧШЕНИЕ: Проверка ретеста Order Block
 * 
 * Ретест происходит, когда цена возвращается к OB после первоначального пробоя.
 * 
 * @param orderBlock - Order Block
 * @param candles - массив свечей
 * @param startIndex - индекс, с которого начинать проверку
 * @returns информация о ретесте
 */
export function checkOrderBlockRetest(
  orderBlock: OrderBlock,
  candles: KlineData[],
  startIndex: number
): {
  retested: boolean;
  retestIndex?: number;
  retestCandle?: KlineData;
  quality: number; // Качество ретеста (0-1)
} {
  // Ищем свечи после BOS, которые вернулись к OB
  for (let i = startIndex + 1; i < candles.length; i++) {
    const candle = candles[i];

    // Проверяем, коснулась ли цена OB
    const touchedOB = candle.low <= orderBlock.high && candle.high >= orderBlock.low;

    if (touchedOB) {
      let quality = 0.5;

      // Оцениваем качество ретеста
      const obCenter = (orderBlock.high + orderBlock.low) / 2;
      const candleCenter = (candle.high + candle.low) / 2;
      const distanceToCenter = Math.abs(candleCenter - obCenter);
      const obSize = orderBlock.high - orderBlock.low;
      const distanceRatio = distanceToCenter / obSize;

      if (distanceRatio < 0.3) {
        quality += 0.3; // Очень близко к центру
      } else if (distanceRatio < 0.5) {
        quality += 0.2; // Близко к центру
      }

      // Объем при ретесте
      const avgVolume = candles
        .slice(-20)
        .reduce((sum, c) => sum + c.volume, 0) / 20;
      if (candle.volume > avgVolume * 1.5) {
        quality += 0.2; // Высокий объем
      }

      return {
        retested: true,
        retestIndex: i,
        retestCandle: candle,
        quality: Math.min(quality, 1.0),
      };
    }
  }

  return {
    retested: false,
    quality: 0,
  };
}

