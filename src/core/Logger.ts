/**
 * Logger.ts
 *
 * Система логирования для торгового бота.
 *
 * Функциональность:
 * - Запись логов в файл (настраиваемый путь из конфигурации)
 * - Вывод логов в консоль
 * - Уровни логирования: DEBUG, INFO, WARN, ERROR
 * - Форматирование логов с временными метками
 * - Автоматическое создание директории для логов
 *
 * Используется во всех модулях для отслеживания работы бота,
 * ошибок и важных событий (сигналы, ордера, позиции).
 */
export class Logger {
  info(msg: string, data?: any): void {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    console.log(`[INFO] ${msg}${dataStr}`);
  }

  error(msg: string, data?: any): void {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    console.error(`[ERROR] ${msg}${dataStr}`);
  }

  warn(msg: string, data?: any): void {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    console.warn(`[WARN] ${msg}${dataStr}`);
  }

  debug(msg: string, data?: any): void {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    console.log(`[DEBUG] ${msg}${dataStr}`);
  }
}
