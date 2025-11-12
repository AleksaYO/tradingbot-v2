/**
 * math.ts
 * 
 * Математические утилиты для анализа рыночных данных.
 * 
 * Функции:
 * - calculateSMA(klines, period) - простая скользящая средняя (Simple Moving Average)
 * - calculateEMA(klines, period) - экспоненциальная скользящая средняя (Exponential Moving Average)
 * - calculateRSI(klines, period) - индекс относительной силы (Relative Strength Index)
 * - getAverageVolume(klines) - средний объем торгов
 * - calculatePercentChange(oldValue, newValue) - процентное изменение
 * - roundTo(value, decimals) - округление до указанного количества знаков
 * - isInRange(value, target, tolerance) - проверка попадания в диапазон
 * 
 * Используется в стратегиях для технического анализа:
 * - Определение трендов
 * - Выявление перекупленности/перепроданности
 * - Расчет индикаторов
 * - Фильтрация сигналов
 */
