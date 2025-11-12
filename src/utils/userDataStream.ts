/**
 * userDataStream.ts
 * 
 * User Data Stream WebSocket для получения приватных данных от Binance Futures
 * 
 * Официальный endpoint:
 * - User Data Stream: wss://fstream.binance.com/ws/<listenKey>
 *   Документация: https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-stream
 * 
 * События:
 * - ACCOUNT_UPDATE - обновление баланса аккаунта
 * - ORDER_TRADE_UPDATE - обновление статуса ордера или позиции
 * - MARGIN_CALL - маржин колл
 */

import WebSocket from "ws";
import axios from "axios";
import { config } from "../core/Config";
import { Logger } from "../core/Logger";

export interface UserDataStreamCallbacks {
  onAccountUpdate?: (data: any) => void;
  onOrderUpdate?: (data: any) => void;
  onPositionUpdate?: (data: any) => void;
  onMarginCall?: (data: any) => void;
  onError?: (error: Error) => void;
  onReconnect?: () => void;
  onClose?: () => void;
}

export interface ListenKeyResponse {
  listenKey: string;
}

/**
 * User Data Stream WebSocket клиент для Binance Futures
 */
export class BinanceUserDataStream {
  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private logger: Logger;
  private callbacks: UserDataStreamCallbacks;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private keepAliveInterval: number = 30 * 60 * 1000; // 30 минут

  constructor(callbacks: UserDataStreamCallbacks, logger: Logger) {
    this.callbacks = callbacks;
    this.logger = logger;
  }

  /**
   * Получение listenKey от Binance
   */
  private async getListenKey(): Promise<string> {
    try {
      const response = await axios.post(
        `${config.binance.futuresBaseUrl}/fapi/v1/listenKey`,
        {},
        {
          headers: {
            "X-MBX-APIKEY": config.binance.apiKey,
          },
          timeout: 10000,
        }
      );

      if (!response.data?.listenKey) {
        throw new Error("Failed to get listenKey from Binance");
      }

      return response.data.listenKey;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get listenKey: ${errorMessage}`, { error });
      throw error;
    }
  }

  /**
   * Продление listenKey (нужно делать каждые 30-60 минут)
   */
  private async keepAliveListenKey(): Promise<void> {
    if (!this.listenKey) {
      return;
    }

    try {
      await axios.put(
        `${config.binance.futuresBaseUrl}/fapi/v1/listenKey`,
        {},
        {
          headers: {
            "X-MBX-APIKEY": config.binance.apiKey,
          },
          params: {
            listenKey: this.listenKey,
          },
          timeout: 10000,
        }
      );

      this.logger.debug("ListenKey kept alive");
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to keep alive listenKey: ${errorMessage}`, { error });
      // При ошибке получаем новый listenKey
      await this.refreshListenKey();
    }
  }

  /**
   * Обновление listenKey
   */
  private async refreshListenKey(): Promise<void> {
    try {
      // Удаляем старый listenKey
      if (this.listenKey) {
        await this.deleteListenKey(this.listenKey);
      }

      // Получаем новый
      this.listenKey = await this.getListenKey();
      this.logger.info("ListenKey refreshed");
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to refresh listenKey: ${errorMessage}`, { error });
      throw error;
    }
  }

  /**
   * Удаление listenKey
   */
  private async deleteListenKey(listenKey: string): Promise<void> {
    try {
      await axios.delete(
        `${config.binance.futuresBaseUrl}/fapi/v1/listenKey`,
        {
          headers: {
            "X-MBX-APIKEY": config.binance.apiKey,
          },
          params: {
            listenKey: listenKey,
          },
          timeout: 10000,
        }
      );
    } catch (error: any) {
      // Игнорируем ошибки при удалении - listenKey может быть уже недействителен
      this.logger.debug(`Failed to delete listenKey (may be already invalid): ${error}`);
    }
  }

  /**
   * Подключение к User Data Stream
   */
  async connect(): Promise<void> {
    if (this.ws && this.isConnected) {
      this.logger.info("User Data Stream already connected");
      return;
    }

    try {
      // Получаем listenKey
      this.listenKey = await this.getListenKey();
      this.logger.info("ListenKey obtained");

      const url = `${config.binance.wsBaseUrl}/ws/${this.listenKey}`;
      this.logger.info(`Connecting to User Data Stream: ${url}`);

      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.logger.info("User Data Stream connected");
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startKeepAlive();
        if (this.callbacks.onReconnect) {
          this.callbacks.onReconnect();
        }
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        let messageStr: string = "";
        try {
          messageStr = data.toString();
          if (!messageStr || messageStr.trim().length === 0) {
            return;
          }

          const message = JSON.parse(messageStr);
          this.handleMessage(message);
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Error parsing User Data Stream message: ${errorMessage}`, {
            error,
            data: messageStr ? messageStr.substring(0, 100) : "Unable to convert data to string",
          });
        }
      });

      this.ws.on("error", (error: Error) => {
        this.logger.error(`User Data Stream error: ${error.message}`, { error });
        this.isConnected = false;
        this.stopKeepAlive();

        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason ? reason.toString() : "No reason provided";
        this.logger.warn(`User Data Stream closed: code=${code}, reason=${reasonStr}`);
        this.isConnected = false;
        this.stopKeepAlive();

        // Планируем переподключение
        if (code !== 1000) {
          this.scheduleReconnect();
        }

        if (this.callbacks.onClose) {
          this.callbacks.onClose();
        }
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to connect User Data Stream: ${errorMessage}`, { error });
      this.scheduleReconnect();
    }
  }

  /**
   * Обработка входящих сообщений
   */
  private handleMessage(message: any): void {
    try {
      if (!message || typeof message !== "object") {
        return;
      }

      const eventType = message.e;

      switch (eventType) {
        case "ACCOUNT_UPDATE":
          if (this.callbacks.onAccountUpdate) {
            this.callbacks.onAccountUpdate(message);
          }
          this.logger.debug("Account update received");
          break;

        case "ORDER_TRADE_UPDATE":
          if (this.callbacks.onOrderUpdate) {
            this.callbacks.onOrderUpdate(message);
          }
          
          // Также обрабатываем как обновление позиции, если это исполнение ордера
          if (message.o?.X === "FILLED" && this.callbacks.onPositionUpdate) {
            this.callbacks.onPositionUpdate(message);
          }
          
          this.logger.debug(`Order update received: ${message.o?.s} ${message.o?.X}`);
          break;

        case "MARGIN_CALL":
          if (this.callbacks.onMarginCall) {
            this.callbacks.onMarginCall(message);
          }
          this.logger.warn("Margin call received!");
          break;

        default:
          this.logger.debug(`Unknown event type: ${eventType}`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error handling User Data Stream message: ${errorMessage}`, {
        error,
        message,
      });
    }
  }

  /**
   * Запуск keep-alive для listenKey
   */
  private startKeepAlive(): void {
    // Продлеваем listenKey каждые 30 минут
    this.keepAliveTimer = setInterval(() => {
      this.keepAliveListenKey().catch((error) => {
        this.logger.error(`Keep-alive failed: ${error.message}`);
      });
    }, this.keepAliveInterval);
  }

  /**
   * Остановка keep-alive
   */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Планирование переподключения
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Max reconnect attempts (${this.maxReconnectAttempts}) reached for User Data Stream`
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      config.websocket.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    this.logger.info(
      `Scheduling User Data Stream reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.refreshListenKey();
        await this.connect();
      } catch (error: any) {
        this.logger.error(`Reconnect failed: ${error.message}`);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Отключение от User Data Stream
   */
  async disconnect(): Promise<void> {
    this.logger.info("Disconnecting User Data Stream...");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopKeepAlive();

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "Client disconnect");
      }
      this.ws = null;
    }

    // Удаляем listenKey
    if (this.listenKey) {
      await this.deleteListenKey(this.listenKey);
      this.listenKey = null;
    }

    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.logger.info("User Data Stream disconnected");
  }

  /**
   * Проверка статуса подключения
   */
  isConnectedStatus(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

