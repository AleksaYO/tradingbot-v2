/**
 * strategy.test.ts
 *
 * Тесты для торговых стратегий (SMC и других).
 *
 * Тестовые сценарии:
 * - Обнаружение FVG (Fair Value Gap)
 * - Определение зон ликвидности
 * - Генерация торговых сигналов
 * - Корректность расчета индикаторов
 * - Обработка граничных случаев (недостаточно данных, пустые массивы)
 *
 * Использует:
 * - Jest как тестовый фреймворк
 * - ts-jest для поддержки TypeScript
 * - Моки для изоляции тестируемых компонентов
 *
 * Примеры тестов:
 * - should return null when klines array is too short
 * - should detect bullish trend with volume confirmation
 * - should detect bullish FVG
 * - should calculate liquidity zones correctly
 * - should generate LONG signal on resistance breakout
 */
