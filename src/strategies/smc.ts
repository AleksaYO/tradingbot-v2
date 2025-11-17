/**
 * smc.ts
 * 
 * МОДУЛЬ 5. SMC Entry Logic
 * 
 * Smart Money Concept (SMC) стратегия для торговли на фьючерсах.
 * 
 * Основные компоненты:
 * - Swing High/Low для определения структуры
 * - Fair Value Gaps (FVG) для поиска зон возврата
 * - BOS (Break of Structure) для определения смены тренда
 * - Order Blocks для определения зон входа
 * 
 * Логика входа:
 * - Ждем BOS (пробитие структуры)
 * - Находим Order Block, который вызвал BOS
 * - Входим, когда цена возвращается в Order Block
 * - Стоп-лосс ставим за границу Order Block
 */

import { KlineData, Signal } from "../types";
import { findSwings, SwingPoint } from "../utils/swing";
import { findFVG, FVGPoint, getNearestUnfilledFVG } from "../utils/fvg";
import {
  detectStructure,
  detectCHoCH,
  StructureChange,
} from "../utils/structure";
import {
  findOrderBlock,
  OrderBlock,
  isPriceInOrderBlock,
  getValidOrderBlocks,
} from "../utils/orderBlock";

export interface SMCSignal {
  side: "BUY" | "SELL";
  entry: number;
  stop: number;
  ob: OrderBlock;
  structure: StructureChange;
  confidence: number;
  reason: string;
  fvg?: FVGPoint; // Опционально: ближайший FVG
}

/**
 * МОДУЛЬ 5. SMC Entry Logic
 * 
 * Главная функция стратегии SMC для генерации торговых сигналов.
 * 
 * Правило входа:
 * 1. Определяем BOS (Break of Structure)
 * 2. Находим Order Block, который вызвал BOS
 * 3. Ждем возврата цены в Order Block
 * 4. Входим в направлении BOS
 * 
 * @param candles - массив свечей (KlineData)
 * @param lastPrice - текущая цена
 * @returns торговый сигнал или null
 */
export function smcStrategy(
  candles: KlineData[],
  lastPrice: number,
  logger?: any // Опциональный logger для диагностики
): SMCSignal | null {
  if (candles.length < 10) {
    if (logger) logger.debug(`SMC: Not enough candles: ${candles.length} < 10`);
    return null; // Недостаточно данных
  }

  // 1. Находим Swing точки
  const swings = findSwings(candles, 3);
  if (swings.length < 4) {
    if (logger) logger.debug(`SMC: Not enough swings: ${swings.length} < 4`);
    return null; // Недостаточно Swing точек
  }
  if (logger) logger.debug(`SMC: Found ${swings.length} swing points`);

  // 2. Определяем структуру (BOS)
  const structure = detectStructure(swings);
  if (!structure) {
    if (logger) logger.debug(`SMC: No BOS detected`);
    return null; // Нет BOS
  }
  if (logger) logger.info(`SMC: BOS detected: ${structure.direction} @ ${structure.price.toFixed(2)}`);

  // 3. Находим FVG (для дополнительного анализа)
  const fvgs = findFVG(candles);

  // 4. Находим Order Block, который вызвал BOS
  const orderBlock = findOrderBlock(candles, structure);
  if (!orderBlock) {
    if (logger) logger.debug(`SMC: Order Block not found for BOS`);
    return null; // Order Block не найден
  }
  if (logger) logger.info(`SMC: Order Block found: ${orderBlock.type} @ ${orderBlock.low.toFixed(2)}-${orderBlock.high.toFixed(2)}`);

  // 5. Проверяем, что Order Block еще валиден (не пробит)
  const validOBs = getValidOrderBlocks([orderBlock], lastPrice);
  if (validOBs.length === 0) {
    if (logger) logger.debug(`SMC: Order Block broken/invalid. Price: ${lastPrice.toFixed(2)}, OB: ${orderBlock.low.toFixed(2)}-${orderBlock.high.toFixed(2)}`);
    return null; // Order Block пробит
  }

  // 6. Правило входа: цена должна быть в Order Block
  const priceInOB = isPriceInOrderBlock(orderBlock, lastPrice);
  if (logger) logger.info(`SMC: Price ${lastPrice.toFixed(2)} in Order Block: ${priceInOB} (OB: ${orderBlock.low.toFixed(2)}-${orderBlock.high.toFixed(2)})`);
  
  if (structure.direction === "bullish") {
    // Bullish BOS: цена откатывается в Order Block
    if (priceInOB) {
      // Находим ближайший FVG для дополнительной информации
      const nearestFVG = getNearestUnfilledFVG(fvgs, lastPrice, "bullish");

      return {
        side: "BUY",
        entry: lastPrice,
        stop: orderBlock.low, // Стоп ниже Order Block
        ob: orderBlock,
        structure: structure,
        confidence: calculateConfidence(structure, orderBlock, fvgs, swings),
        reason: `Bullish BOS detected. Price in Order Block. Entry: ${lastPrice.toFixed(2)}, Stop: ${orderBlock.low.toFixed(2)}`,
        fvg: nearestFVG || undefined,
      };
    }
  }

  if (structure.direction === "bearish") {
    // Bearish BOS: цена откатывается в Order Block
    if (isPriceInOrderBlock(orderBlock, lastPrice)) {
      // Находим ближайший FVG для дополнительной информации
      const nearestFVG = getNearestUnfilledFVG(fvgs, lastPrice, "bearish");

      return {
        side: "SELL",
        entry: lastPrice,
        stop: orderBlock.high, // Стоп выше Order Block
        ob: orderBlock,
        structure: structure,
        confidence: calculateConfidence(structure, orderBlock, fvgs, swings),
        reason: `Bearish BOS detected. Price in Order Block. Entry: ${lastPrice.toFixed(2)}, Stop: ${orderBlock.high.toFixed(2)}`,
        fvg: nearestFVG || undefined,
      };
    }
  }

  return null;
}

/**
 * Расчет уверенности в сигнале (0-1)
 * 
 * Факторы, влияющие на уверенность:
 * - Сила BOS (разница между swing точками)
 * - Размер Order Block
 * - Наличие FVG рядом
 * - Структура рынка
 * 
 * @param structure - BOS структура
 * @param orderBlock - Order Block
 * @param fvgs - массив FVG
 * @param swings - массив Swing точек
 * @returns уверенность от 0 до 1
 */
function calculateConfidence(
  structure: StructureChange,
  orderBlock: OrderBlock,
  fvgs: FVGPoint[],
  swings: SwingPoint[]
): number {
  let confidence = 0.5; // Базовая уверенность

  // 1. Сила BOS (разница между swing точками)
  const swingDiff = Math.abs(
    structure.currentSwing.price - structure.previousSwing.price
  );
  const priceRange = Math.max(...swings.map((s) => s.price)) -
    Math.min(...swings.map((s) => s.price));
  const swingStrength = Math.min(swingDiff / priceRange, 1);
  confidence += swingStrength * 0.2; // До +0.2

  // 2. Размер Order Block (меньше = лучше)
  const obSize = orderBlock.high - orderBlock.low;
  const avgCandleSize =
    swings.reduce((sum, s) => sum + (s.kline.high - s.kline.low), 0) /
    swings.length;
  const obRatio = Math.min(obSize / avgCandleSize, 2);
  confidence += (1 - obRatio / 2) * 0.15; // До +0.15

  // 3. Наличие FVG рядом с Order Block
  const obCenter = (orderBlock.high + orderBlock.low) / 2;
  const nearbyFVG = fvgs.find(
    (fvg) =>
      !fvg.filled &&
      Math.abs((fvg.start + fvg.end) / 2 - obCenter) < obSize * 2
  );
  if (nearbyFVG) {
    confidence += 0.1; // +0.1 за наличие FVG
  }

  // 4. Структура рынка (тренд в направлении сигнала)
  const isUptrend = swings
    .filter((s) => s.type === "high")
    .slice(-2)
    .every((s, i, arr) => i === 0 || s.price > arr[i - 1].price);
  const isDowntrend = swings
    .filter((s) => s.type === "low")
    .slice(-2)
    .every((s, i, arr) => i === 0 || s.price < arr[i - 1].price);

  if (
    (structure.direction === "bullish" && isUptrend) ||
    (structure.direction === "bearish" && isDowntrend)
  ) {
    confidence += 0.05; // +0.05 за совпадение с трендом
  }

  return Math.min(confidence, 1.0); // Ограничиваем до 1.0
}

/**
 * Конвертация SMCSignal в Signal для использования в системе
 * 
 * @param smcSignal - сигнал от SMC стратегии
 * @param symbol - символ торговой пары
 * @returns объект Signal
 */
export function convertToSignal(
  smcSignal: SMCSignal,
  symbol: string
): Signal {
  // Рассчитываем take profit на основе структуры
  const obSize = smcSignal.ob.high - smcSignal.ob.low;
  const riskRewardRatio = 2; // 1:2 риск/прибыль

  let takeProfit: number;
  if (smcSignal.side === "BUY") {
    const risk = smcSignal.entry - smcSignal.stop;
    takeProfit = smcSignal.entry + risk * riskRewardRatio;
  } else {
    const risk = smcSignal.stop - smcSignal.entry;
    takeProfit = smcSignal.entry - risk * riskRewardRatio;
  }

  return {
    type: smcSignal.side === "BUY" ? "LONG" : "SHORT",
    symbol: symbol,
    entryPrice: smcSignal.entry,
    stopLoss: smcSignal.stop,
    takeProfit: takeProfit,
    confidence: smcSignal.confidence,
    reason: smcSignal.reason,
  };
}

/**
 * Расширенная версия стратегии с дополнительными фильтрами
 * 
 * @param candles - массив свечей
 * @param lastPrice - текущая цена
 * @param options - дополнительные опции фильтрации
 * @returns торговый сигнал или null
 */
export function smcStrategyAdvanced(
  candles: KlineData[],
  lastPrice: number,
  options?: {
    minConfidence?: number;
    requireFVG?: boolean;
    maxOrderBlockAge?: number; // Максимальный возраст Order Block в свечах
  }
): SMCSignal | null {
  const signal = smcStrategy(candles, lastPrice);
  if (!signal) {
    return null;
  }

  // Фильтр по минимальной уверенности
  if (options?.minConfidence && signal.confidence < options.minConfidence) {
    return null;
  }

  // Фильтр по наличию FVG
  if (options?.requireFVG && !signal.fvg) {
    return null;
  }

  // Фильтр по возрасту Order Block
  if (options?.maxOrderBlockAge) {
    const obAge = candles.length - signal.ob.index;
    if (obAge > options.maxOrderBlockAge) {
      return null; // Order Block слишком старый
    }
  }

  return signal;
}

/**
 * Получение всех потенциальных сигналов (без фильтра по цене в Order Block)
 * 
 * Полезно для мониторинга и анализа
 * 
 * @param candles - массив свечей
 * @param lastPrice - текущая цена
 * @returns массив потенциальных сигналов
 */
export function getPotentialSignals(
  candles: KlineData[],
  lastPrice: number
): SMCSignal[] {
  const signals: SMCSignal[] = [];

  if (candles.length < 10) {
    return signals;
  }

  const swings = findSwings(candles, 3);
  if (swings.length < 4) {
    return signals;
  }

  const structure = detectStructure(swings);
  if (!structure) {
    return signals;
  }

  const fvgs = findFVG(candles);
  const orderBlock = findOrderBlock(candles, structure);

  if (!orderBlock) {
    return signals;
  }

  // Создаем сигнал независимо от того, находится ли цена в Order Block
  const validOBs = getValidOrderBlocks([orderBlock], lastPrice);
  if (validOBs.length === 0) {
    return signals;
  }

  const nearestFVG = getNearestUnfilledFVG(
    fvgs,
    lastPrice,
    structure.direction === "bullish" ? "bullish" : "bearish"
  );

  signals.push({
    side: structure.direction === "bullish" ? "BUY" : "SELL",
    entry: lastPrice,
    stop:
      structure.direction === "bullish" ? orderBlock.low : orderBlock.high,
    ob: orderBlock,
    structure: structure,
    confidence: calculateConfidence(structure, orderBlock, fvgs, swings),
    reason: `${structure.direction.toUpperCase()} BOS detected. Order Block: ${orderBlock.low.toFixed(2)} - ${orderBlock.high.toFixed(2)}`,
    fvg: nearestFVG || undefined,
  });

  return signals;
}
