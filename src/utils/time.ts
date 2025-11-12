/**
 * time.ts
 * 
 * Утилиты для работы со временем и временными метками.
 * 
 * Функции:
 * - formatTimestamp(timestamp) - форматирование timestamp в ISO строку
 * - hasTimePassed(timestamp, milliseconds) - проверка, прошло ли время
 * - getStartOfDay(timestamp) - получение начала дня для timestamp
 * - isNewDay(timestamp, previousTimestamp) - проверка начала нового дня
 * - formatDuration(milliseconds) - форматирование длительности в читаемый формат
 * 
 * Используется для:
 * - Обработки временных меток от Binance (в миллисекундах)
 * - Отслеживания времени жизни позиций
 * - Сброса дневных лимитов (max loss per day)
 * - Логирования с временными метками
 * - Анализа временных паттернов в стратегиях
 */
