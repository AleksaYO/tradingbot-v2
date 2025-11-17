/**
 * timeSync.ts
 * 
 * Утилита для синхронизации времени с сервером Binance.
 * 
 * Проблема: Binance требует точную синхронизацию времени для валидации подписи запросов.
 * Если локальное время отличается от серверного более чем на несколько секунд,
 * запросы будут отклоняться с ошибкой -1022 (Invalid signature).
 * 
 * Решение: Получаем время сервера Binance и вычисляем offset для корректировки локального времени.
 * 
 * Endpoint: GET /fapi/v1/time (для Futures API)
 */

import axios from "axios";
import { Logger } from "../core/Logger";

export class TimeSync {
  private static instance: TimeSync | null = null;
  private timeOffset: number = 0;
  private lastSyncTime: number = 0;
  private syncInterval: number = 60 * 60 * 1000; // Синхронизация каждый час
  private syncTimer: NodeJS.Timeout | null = null;
  private logger: Logger | null = null;
  private isSyncing: boolean = false;

  private constructor(logger?: Logger) {
    this.logger = logger || null;
  }

  /**
   * Получение singleton экземпляра TimeSync
   */
  static getInstance(logger?: Logger): TimeSync {
    if (!TimeSync.instance) {
      TimeSync.instance = new TimeSync(logger);
    }
    return TimeSync.instance;
  }

  /**
   * Синхронизация времени с сервером Binance
   * 
   * @param force - принудительная синхронизация (игнорирует таймер)
   * @returns Promise<void>
   */
  async sync(force: boolean = false): Promise<void> {
    // Предотвращаем параллельные синхронизации
    if (this.isSyncing && !force) {
      return;
    }

    this.isSyncing = true;

    try {
      const localTime = Date.now();
      
      // Получаем время сервера Binance Futures
      const response = await axios.get("https://fapi.binance.com/fapi/v1/time", {
        timeout: 5000,
      });

      const serverTime = response.data.serverTime;
      
      if (!serverTime || typeof serverTime !== "number") {
        throw new Error("Invalid server time response from Binance");
      }

      // Вычисляем offset: serverTime - localTime
      this.timeOffset = serverTime - localTime;
      this.lastSyncTime = Date.now();

      if (this.logger) {
        const offsetSecondsNum = this.timeOffset / 1000;
        const offsetSeconds = offsetSecondsNum.toFixed(2);
        this.logger.info(
          `⏰ Time synchronized with Binance server. Offset: ${offsetSecondsNum > 0 ? "+" : ""}${offsetSeconds} seconds`
        );
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (this.logger) {
        this.logger.error(`Failed to sync time with Binance: ${errorMessage}`);
        this.logger.warn("⚠️  Using local time (may cause signature errors if time is out of sync)");
      }
      
      // В случае ошибки используем offset = 0 (локальное время)
      this.timeOffset = 0;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Получение синхронизированного времени (локальное время + offset)
   * 
   * @returns синхронизированный timestamp в миллисекундах
   */
  getSyncedTime(): number {
    return Date.now() + this.timeOffset;
  }

  /**
   * Получение текущего offset
   * 
   * @returns offset в миллисекундах
   */
  getOffset(): number {
    return this.timeOffset;
  }

  /**
   * Запуск автоматической периодической синхронизации
   * 
   * @param interval - интервал синхронизации в миллисекундах (по умолчанию 1 час)
   */
  startAutoSync(interval?: number): void {
    if (this.syncTimer) {
      this.stopAutoSync();
    }

    if (interval) {
      this.syncInterval = interval;
    }

    // Первая синхронизация сразу
    this.sync(true).catch(() => {
      // Ошибка уже залогирована в sync()
    });

    // Периодическая синхронизация
    this.syncTimer = setInterval(() => {
      this.sync().catch(() => {
        // Ошибка уже залогирована в sync()
      });
    }, this.syncInterval);

    if (this.logger) {
      this.logger.info(
        `⏰ Auto time sync enabled (every ${this.syncInterval / 1000 / 60} minutes)`
      );
    }
  }

  /**
   * Остановка автоматической синхронизации
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      
      if (this.logger) {
        this.logger.info("⏰ Auto time sync stopped");
      }
    }
  }

  /**
   * Проверка, нужно ли повторно синхронизировать время
   * (если прошло больше часа с последней синхронизации)
   * 
   * @returns true если нужна повторная синхронизация
   */
  needsResync(): boolean {
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    return timeSinceLastSync > this.syncInterval;
  }

  /**
   * Получение времени последней синхронизации
   * 
   * @returns timestamp последней синхронизации
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }
}

