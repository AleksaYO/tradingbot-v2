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

import * as fs from "fs";
import * as path from "path";
import { Config } from "./Config";

type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  private logLevel: LogLevel;
  private logFile: string | null = null;

  constructor() {
    // Определяем уровень логирования из конфигурации
    const configLevel = (Config.logging?.level || "info").toLowerCase();
    this.logLevel = this.parseLogLevel(configLevel);

    // Настраиваем запись в файл
    if (Config.logging?.file) {
      this.logFile = Config.logging.file;
      this.ensureLogDirectory();
    }
  }

  /**
   * Создание директории для логов, если она не существует
   */
  private ensureLogDirectory(): void {
    if (!this.logFile) return;

    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create log directory: ${logDir}`, error);
      }
    }
  }

  /**
   * Запись сообщения в файл
   */
  private writeToFile(message: string): void {
    if (!this.logFile) return;

    try {
      fs.appendFileSync(this.logFile, message + "\n", "utf8");
    } catch (error) {
      // Не логируем ошибки записи в файл, чтобы избежать бесконечного цикла
      console.error(`Failed to write to log file: ${this.logFile}`, error);
    }
  }

  private parseLogLevel(level: string): LogLevel {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const index = levels.indexOf(level as LogLevel);
    return index >= 0 ? (level as LogLevel) : "info";
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  private formatMessage(level: string, msg: string, data?: any): string {
    // Форматируем время в локальном формате: YYYY-MM-DD HH:mm:ss
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
    
    // Эмодзи для разных уровней логирования
    const levelEmoji: Record<string, string> = {
      info: "ℹ️",
      error: "❌",
      warn: "⚠️",
      debug: "🔍"
    };
    
    const emoji = levelEmoji[level.toLowerCase()] || "ℹ️";
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    return `[${timestamp}] ${emoji} ${msg}${dataStr}`;
  }

  info(msg: string, data?: any): void {
    if (!this.shouldLog("info")) return;
    const formatted = this.formatMessage("info", msg, data);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  error(msg: string, data?: any): void {
    if (!this.shouldLog("error")) return;
    const formatted = this.formatMessage("error", msg, data);
    console.error(formatted);
    this.writeToFile(formatted);
  }

  warn(msg: string, data?: any): void {
    if (!this.shouldLog("warn")) return;
    const formatted = this.formatMessage("warn", msg, data);
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  debug(msg: string, data?: any): void {
    if (!this.shouldLog("debug")) return;
    const formatted = this.formatMessage("debug", msg, data);
    console.log(formatted);
    this.writeToFile(formatted);
  }
}
