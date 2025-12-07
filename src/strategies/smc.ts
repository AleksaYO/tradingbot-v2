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
import { 
  findSwings, 
  SwingPoint,
  findSwingsEnhanced,
  getSwingOverallStrength,
  updateLiquidityHighLow,
} from "../utils/swing";
import { 
  findFVG, 
  FVGPoint, 
  getNearestUnfilledFVG,
  findFVGEnhanced,
  evaluateFVGQuality,
} from "../utils/fvg";
import {
  detectStructure,
  detectCHoCH,
  StructureChange,
  detectStructureEnhanced,
  validateBOSQuality,
  isBOSImpulseStrong,
  hasLiquiditySweepBeforeBOS,
} from "../utils/structure";
import {
  findOrderBlock,
  OrderBlock,
  isPriceInOrderBlock,
  getValidOrderBlocks,
  findOrderBlockEnhanced,
  validateOrderBlockQuality,
  refineOrderBlock,
  checkOrderBlockRetest,
  getOrderBlockVolumeStrength,
  getOrderBlockWickStrength,
} from "../utils/orderBlock";
import {
  updateLiquidityLevels,
  detectLiquiditySweeps,
  getNearestLiquidityLevels,
  evaluateSweepQuality,
  LiquidityLevel,
} from "../utils/liquidity";
import {
  isImpulseStrong,
  isCorrectionWeak,
  analyzeMovementQuality,
} from "../utils/impulse";
import {
  confirmSignal,
  confirmWithCandle,
  detectRetest,
  ConfirmationResult,
} from "../utils/confirmation";

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
/**
 * УЛУЧШЕНИЕ: Основная функция стратегии SMC с улучшенной логикой
 * 
 * Включает все улучшения:
 * - Улучшенная детекция swing точек
 * - Фильтры силы импульса и слабости коррекции
 * - Анализ ликвидности и sweep'ов
 * - Подтверждение свечой
 * - Расширенный confidence score
 */
export function smcStrategy(
  candles: KlineData[],
  lastPrice: number,
  logger?: any // Опциональный logger для диагностики
): SMCSignal | null {
  if (candles.length < 20) {
    if (logger) logger.debug(`SMC: Not enough candles: ${candles.length} < 20`);
    return null; // Недостаточно данных (увеличено требование)
  }

  // 1. УЛУЧШЕНИЕ: Находим Swing точки с улучшенной фильтрацией
  const swings = findSwingsEnhanced(candles, undefined, 0.3, 0.2);
  if (swings.length < 4) {
    if (logger) logger.debug(`SMC: Not enough swings: ${swings.length} < 4`);
    return null; // Недостаточно Swing точек
  }
  if (logger) logger.debug(`SMC: Found ${swings.length} swing points (enhanced)`);

  // 2. УЛУЧШЕНИЕ: Определяем структуру (BOS) с улучшенной детекцией
  // Используем улучшенную детекцию, но не требуем обязательный sweep (чтобы не пропускать сигналы)
  const structure = detectStructureEnhanced(swings, candles, false, false);
  if (!structure) {
    if (logger) logger.debug(`SMC: No BOS detected`);
    return null; // Нет BOS
  }
  if (logger) logger.info(`SMC: BOS detected: ${structure.direction} @ ${structure.price.toFixed(2)}`);

  // 3. УЛУЧШЕНИЕ: Находим FVG с улучшенной фильтрацией
  const fvgs = findFVGEnhanced(candles, 0.5, true);
  if (logger && fvgs.length > 0) {
    const unfilledFvgs = fvgs.filter(fvg => !fvg.filled);
    logger.debug(`SMC: Found ${fvgs.length} FVGs (${unfilledFvgs.length} unfilled)`);
  }

  // 4. УЛУЧШЕНИЕ: Находим Order Block с улучшенной логикой
  const orderBlock = findOrderBlockEnhanced(candles, structure, 0.5);
  if (!orderBlock) {
    if (logger) logger.debug(`SMC: Order Block not found or quality too low`);
    return null; // Order Block не найден или качество недостаточно
  }

  // УЛУЧШЕНИЕ: Применяем mitigation для уточнения OB
  const refinedOB = refineOrderBlock(orderBlock, candles, structure.index);
  if (logger) logger.info(`SMC: Order Block found: ${refinedOB.type} @ ${refinedOB.low.toFixed(2)}-${refinedOB.high.toFixed(2)}`);

  // 5. Проверяем, что Order Block еще валиден (не пробит)
  const validOBs = getValidOrderBlocks([refinedOB], lastPrice);
  if (validOBs.length === 0) {
    if (logger) logger.debug(`SMC: Order Block broken/invalid. Price: ${lastPrice.toFixed(2)}, OB: ${refinedOB.low.toFixed(2)}-${refinedOB.high.toFixed(2)}`);
    return null; // Order Block пробит
  }

  // 6. УЛУЧШЕНИЕ: Анализ ликвидности
  let liquidityLevels: LiquidityLevel[] = [];
  try {
    const { currentHigh, currentLow, highIndex, lowIndex } = updateLiquidityHighLow(candles, 20);
    if (highIndex >= 0) {
      liquidityLevels.push({
        price: currentHigh,
        type: "high",
        index: highIndex,
        timestamp: candles[highIndex].closeTime,
        swept: false,
      });
    }
    if (lowIndex >= 0) {
      liquidityLevels.push({
        price: currentLow,
        type: "low",
        index: lowIndex,
        timestamp: candles[lowIndex].closeTime,
        swept: false,
      });
    }
    // Обновляем статус sweep'ов
    detectLiquiditySweeps(liquidityLevels, candles, 3);
    
    // Логируем информацию о ликвидности
    if (logger && liquidityLevels.length > 0) {
      const sweptLevels = liquidityLevels.filter(l => l.swept);
      logger.debug(`SMC: Found ${liquidityLevels.length} liquidity levels (${sweptLevels.length} swept)`);
      if (sweptLevels.length > 0) {
        logger.debug(`SMC: Swept levels: ${sweptLevels.map(l => `${l.type} @ ${l.price.toFixed(2)}`).join(", ")}`);
      }
    }
  } catch (e) {
    // Игнорируем ошибки анализа ликвидности
    if (logger) logger.debug(`SMC: Liquidity analysis error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 7. УЛУЧШЕНИЕ: Правило входа с подтверждением
  const priceInOB = isPriceInOrderBlock(refinedOB, lastPrice);
  if (logger) logger.info(`SMC: Price ${lastPrice.toFixed(2)} in Order Block: ${priceInOB} (OB: ${refinedOB.low.toFixed(2)}-${refinedOB.high.toFixed(2)})`);
  
  if (structure.direction === "bullish") {
    // Bullish BOS: цена откатывается в Order Block
    if (priceInOB) {
      // УЛУЧШЕНИЕ: Подтверждение сигнала
      const confirmation = confirmSignal(
        "BUY",
        refinedOB,
        structure,
        candles,
        true, // Требуем подтверждение свечой
        false // Ретест не обязателен, но желателен
      );

      if (!confirmation.confirmed) {
        if (logger) logger.info(`SMC: Signal not confirmed: ${confirmation.reason} (confidence: ${(confirmation.confidence * 100).toFixed(1)}%)`);
        return null; // Сигнал не подтвержден
      }

      // Находим ближайший FVG для дополнительной информации
      const nearestFVG = getNearestUnfilledFVG(fvgs, lastPrice, "bullish");
      if (logger && nearestFVG) {
        logger.info(`SMC: Nearest FVG: ${nearestFVG.type} @ ${nearestFVG.start.toFixed(2)}-${nearestFVG.end.toFixed(2)}`);
      }

      // УЛУЧШЕНИЕ: Используем расширенный confidence с учетом всех факторов
      const confidence = calculateConfidence(
        structure,
        refinedOB,
        fvgs,
        swings,
        candles,
        liquidityLevels
      );
      
      // Логируем детали confidence
      if (logger) {
        const hasSweep = hasLiquiditySweepBeforeBOS(structure, candles);
        const impulseStrong = isImpulseStrong(candles, swings, structure.direction, 0.4);
        const correctionWeak = isCorrectionWeak(candles, swings, structure.direction, 50);
        const nearbyFVG = fvgs.find(
          (fvg) =>
            !fvg.filled &&
            Math.abs((fvg.start + fvg.end) / 2 - (refinedOB.high + refinedOB.low) / 2) < (refinedOB.high - refinedOB.low) * 2
        );
        logger.info(`SMC: Analysis factors - Impulse: ${impulseStrong ? "strong" : "weak"}, Correction: ${correctionWeak ? "weak" : "strong"}, Sweep: ${hasSweep ? "yes" : "no"}, Nearby FVG: ${nearbyFVG ? "yes" : "no"}, Confidence: ${(confidence * 100).toFixed(1)}%`);
      }

      // УЛУЧШЕНИЕ: Учитываем подтверждение в confidence
      const finalConfidence = Math.min(confidence + confirmation.confidence * 0.1, 1.0);

      return {
        side: "BUY",
        entry: confirmation.entryPrice || lastPrice, // Используем цену из подтверждения
        stop: refinedOB.low, // Стоп ниже Order Block
        ob: refinedOB,
        structure: structure,
        confidence: finalConfidence,
        reason: `Bullish BOS detected. Price in Order Block. Entry: ${(confirmation.entryPrice || lastPrice).toFixed(2)}, Stop: ${refinedOB.low.toFixed(2)}. ${confirmation.reason}`,
        fvg: nearestFVG || undefined,
      };
    }
  }

  if (structure.direction === "bearish") {
    // Bearish BOS: цена откатывается в Order Block
    if (isPriceInOrderBlock(refinedOB, lastPrice)) {
      // УЛУЧШЕНИЕ: Подтверждение сигнала
      const confirmation = confirmSignal(
        "SELL",
        refinedOB,
        structure,
        candles,
        true, // Требуем подтверждение свечой
        false // Ретест не обязателен, но желателен
      );

      if (!confirmation.confirmed) {
        if (logger) logger.info(`SMC: Signal not confirmed: ${confirmation.reason} (confidence: ${(confirmation.confidence * 100).toFixed(1)}%)`);
        return null; // Сигнал не подтвержден
      }

      // Находим ближайший FVG для дополнительной информации
      const nearestFVG = getNearestUnfilledFVG(fvgs, lastPrice, "bearish");
      if (logger && nearestFVG) {
        logger.info(`SMC: Nearest FVG: ${nearestFVG.type} @ ${nearestFVG.start.toFixed(2)}-${nearestFVG.end.toFixed(2)}`);
      }

      // УЛУЧШЕНИЕ: Используем расширенный confidence с учетом всех факторов
      const confidence = calculateConfidence(
        structure,
        refinedOB,
        fvgs,
        swings,
        candles,
        liquidityLevels
      );
      
      // Логируем детали confidence
      if (logger) {
        const hasSweep = hasLiquiditySweepBeforeBOS(structure, candles);
        const impulseStrong = isImpulseStrong(candles, swings, structure.direction, 0.4);
        const correctionWeak = isCorrectionWeak(candles, swings, structure.direction, 50);
        const nearbyFVG = fvgs.find(
          (fvg) =>
            !fvg.filled &&
            Math.abs((fvg.start + fvg.end) / 2 - (refinedOB.high + refinedOB.low) / 2) < (refinedOB.high - refinedOB.low) * 2
        );
        logger.info(`SMC: Analysis factors - Impulse: ${impulseStrong ? "strong" : "weak"}, Correction: ${correctionWeak ? "weak" : "strong"}, Sweep: ${hasSweep ? "yes" : "no"}, Nearby FVG: ${nearbyFVG ? "yes" : "no"}, Confidence: ${(confidence * 100).toFixed(1)}%`);
      }

      // УЛУЧШЕНИЕ: Учитываем подтверждение в confidence
      const finalConfidence = Math.min(confidence + confirmation.confidence * 0.1, 1.0);

      return {
        side: "SELL",
        entry: confirmation.entryPrice || lastPrice, // Используем цену из подтверждения
        stop: refinedOB.high, // Стоп выше Order Block
        ob: refinedOB,
        structure: structure,
        confidence: finalConfidence,
        reason: `Bearish BOS detected. Price in Order Block. Entry: ${(confirmation.entryPrice || lastPrice).toFixed(2)}, Stop: ${refinedOB.high.toFixed(2)}. ${confirmation.reason}`,
        fvg: nearestFVG || undefined,
      };
    }
  }

  return null;
}

/**
 * УЛУЧШЕНИЕ: Расширенный расчет уверенности в сигнале (0-1)
 * 
 * Факторы, влияющие на уверенность:
 * - Сила BOS (разница между swing точками)
 * - Размер Order Block
 * - Наличие FVG рядом
 * - Структура рынка
 * - Сила импульса
 * - Слабость коррекции
 * - Анализ ликвидности
 * - Sweep ликвидности
 * - Качество Order Block
 * - Качество FVG
 * 
 * @param structure - BOS структура
 * @param orderBlock - Order Block
 * @param fvgs - массив FVG
 * @param swings - массив Swing точек
 * @param candles - массив свечей
 * @param liquidityLevels - уровни ликвидности
 * @returns уверенность от 0 до 1
 */
function calculateConfidence(
  structure: StructureChange,
  orderBlock: OrderBlock,
  fvgs: FVGPoint[],
  swings: SwingPoint[],
  candles: KlineData[],
  liquidityLevels: LiquidityLevel[] = []
): number {
  let confidence = 0.4; // Базовая уверенность (снижена, так как добавляем больше факторов)

  // 1. Качество BOS (0.15)
  const bosQuality = validateBOSQuality(structure, candles, swings);
  confidence += bosQuality * 0.15;

  // 2. Сила импульса (0.15)
  const impulseStrong = isImpulseStrong(
    candles,
    swings,
    structure.direction,
    0.4
  );
  if (impulseStrong) {
    confidence += 0.15;
  }

  // 3. Слабость коррекции (0.1)
  const correctionWeak = isCorrectionWeak(
    candles,
    swings,
    structure.direction,
    50
  );
  if (correctionWeak) {
    confidence += 0.1;
  }

  // 4. Качество Order Block (0.15)
  const obQuality = validateOrderBlockQuality(orderBlock, candles);
  confidence += obQuality * 0.15;

  // 5. Объем Order Block (0.1)
  const obVolumeStrength = getOrderBlockVolumeStrength(orderBlock, candles);
  confidence += obVolumeStrength * 0.1;

  // 6. Фитили Order Block (0.05)
  const obWickStrength = getOrderBlockWickStrength(orderBlock);
  confidence += obWickStrength * 0.05;

  // 7. Наличие FVG рядом с Order Block (0.1)
  const obCenter = (orderBlock.high + orderBlock.low) / 2;
  const nearbyFVG = fvgs.find(
    (fvg) =>
      !fvg.filled &&
      Math.abs((fvg.start + fvg.end) / 2 - obCenter) < (orderBlock.high - orderBlock.low) * 2
  );
  if (nearbyFVG) {
    const fvgQuality = evaluateFVGQuality(nearbyFVG, candles);
    confidence += fvgQuality * 0.1; // Учитываем качество FVG
  }

  // 8. Sweep ликвидности перед BOS (0.1)
  if (hasLiquiditySweepBeforeBOS(structure, candles)) {
    confidence += 0.1;
  }

  // 9. Анализ ликвидности (0.05)
  const { nearestHigh, nearestLow } = getNearestLiquidityLevels(
    liquidityLevels,
    candles[candles.length - 1].close
  );
  if (
    (structure.direction === "bullish" && nearestLow && !nearestLow.swept) ||
    (structure.direction === "bearish" && nearestHigh && !nearestHigh.swept)
  ) {
    confidence += 0.05; // Есть непротестенный уровень ликвидности
  }

  // 10. Качество движения (0.05)
  const movementQuality = analyzeMovementQuality(
    candles,
    swings,
    structure.direction
  );
  confidence += movementQuality * 0.05;

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
    confidence: calculateConfidence(structure, orderBlock, fvgs, swings, candles),
    reason: `${structure.direction.toUpperCase()} BOS detected. Order Block: ${orderBlock.low.toFixed(2)} - ${orderBlock.high.toFixed(2)}`,
    fvg: nearestFVG || undefined,
  });

  return signals;
}
