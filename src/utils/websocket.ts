import WebSocket from "ws";
import { config } from "../core/Config";
import { Logger } from "../core/Logger";
import { KlineData, AggTradeData, DepthData } from "../types";

export type StreamType = "aggTrade" | "kline" | "depth";

export interface StreamCallbacks {
  onKline?: (data: KlineData) => void;
  onAggTrade?: (data: AggTradeData) => void;
  onDepth?: (data: DepthData) => void;
  onError?: (error: Error) => void;
  onReconnect?: () => void;
  onClose?: () => void;
}

/**
 * Интерфейс для WebSocket сообщения от Binance
 */
interface BinanceStreamMessage {
  stream: string;
  data: any;
}

/**
 * WebSocket клиент для подключения к Binance Futures WebSocket API
 */
export class BinanceWebSocket {
  private ws: WebSocket | null = null;
  private symbol: string;
  private streams: StreamType[];
  private callbacks: StreamCallbacks;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private logger: Logger;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor(
    symbol: string,
    streams: StreamType[],
    callbacks: StreamCallbacks,
    logger: Logger
  ) {
    this.symbol = symbol.toLowerCase();
    this.streams = streams;
    this.callbacks = callbacks;
    this.logger = logger;
  }

  /**
   * Подключение к WebSocket
   */
  connect(): void {
    if (this.ws && this.isConnected) {
      this.logger.info("WebSocket already connected");
      return;
    }

    // Формируем URL для множественных потоков
    const streamNames = this.streams.map((stream) => {
      switch (stream) {
        case "aggTrade":
          return `${this.symbol}@aggTrade`;
        case "kline":
          return `${this.symbol}@kline_1m`;
        case "depth":
          return `${this.symbol}@depth20@100ms`;
        default:
          return "";
      }
    })
      .filter(Boolean)
      .join("/");

    const url = `${config.binance.wsBaseUrl}/stream?streams=${streamNames}`;

    this.logger.info(`Connecting to Binance WebSocket: ${url}`);

    try {
      // Добавляем таймаут для подключения (30 секунд)
      const connectionTimeout = 30000;
      let connectionTimer: NodeJS.Timeout | null = null;

      this.ws = new WebSocket(url);

      // Устанавливаем таймаут подключения
      connectionTimer = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.logger.error(`WebSocket connection timeout after ${connectionTimeout}ms`);
          if (this.ws) {
            this.ws.terminate();
          }
          connectionTimer = null;
        }
      }, connectionTimeout);

      this.ws.on("open", () => {
        // Очищаем таймаут при успешном подключении
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }
        this.logger.info("WebSocket connected to Binance");
        this.isConnected = true;
        this.resetReconnectAttempts(); // Сбрасываем счетчик при успешном подключении
        this.startPing();
        if (this.callbacks.onReconnect) {
          this.callbacks.onReconnect();
        }
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const messageStr = data.toString();
          if (!messageStr || messageStr.trim().length === 0) {
            this.logger.debug("Received empty WebSocket message");
            return;
          }

          const message: BinanceStreamMessage = JSON.parse(messageStr);
          this.handleMessage(message);
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Error parsing WebSocket message: ${errorMessage}`, {
            error,
            data: data.toString().substring(0, 100), // Логируем только первые 100 символов
          });
        }
      });

      this.ws.on("error", (error: Error) => {
        // Очищаем таймаут при ошибке
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }

        const errorMessage = error.message || "Unknown WebSocket error";
        const errorCode = (error as any).code;
        
        // Улучшенная обработка ошибок таймаута
        if (errorCode === "ETIMEDOUT" || errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
          this.logger.error(
            `WebSocket connection timeout: ${errorMessage} | ` +
            `This usually means network connectivity issues or Binance server is unreachable. ` +
            `The bot will attempt to reconnect automatically.`
          );
        } else {
          this.logger.error(`WebSocket error: ${errorMessage}`, { error });
        }
        
        this.isConnected = false;
        this.stopPing();
        
        // Не планируем переподключение при ошибке - оно произойдет при close
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        // Очищаем таймаут при закрытии
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }

        const reasonStr = reason ? reason.toString() : "No reason provided";
        this.logger.warn(`WebSocket closed: code=${code}, reason=${reasonStr}`);
        this.isConnected = false;
        this.stopPing();

        // Планируем переподключение только если это не было запрошено вручную
        // Коды закрытия: 1000 (normal), 1001 (going away), 1006 (abnormal)
        if (code !== 1000) {
          this.scheduleReconnect();
        }

        if (this.callbacks.onClose) {
          this.callbacks.onClose();
        }
      });

      this.ws.on("pong", () => {
        // Получен ответ на ping
      });
    } catch (error) {
      this.logger.error(`Failed to create WebSocket: ${error}`, { error });
      this.scheduleReconnect();
    }
  }

  /**
   * Обработка входящих сообщений
   */
  private handleMessage(message: BinanceStreamMessage): void {
    try {
      // Валидация структуры сообщения
      if (!message || typeof message !== "object") {
        this.logger.debug("Invalid message format received");
        return;
      }

      if (!message.stream || !message.data) {
        this.logger.debug("Message missing stream or data field");
        return;
      }

      const stream = message.stream;
      const data = message.data;

      // Маршрутизация по типу потока
      if (stream.includes("@kline")) {
        this.handleKline(data);
      } else if (stream.includes("@aggTrade")) {
        this.handleAggTrade(data);
      } else if (stream.includes("@depth")) {
        this.handleDepth(data);
      } else {
        this.logger.debug(`Unknown stream type: ${stream}`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error handling WebSocket message: ${errorMessage}`, { error, message });
    }
  }

  /**
   * Обработка данных свечей (kline)
   */
  private handleKline(data: any): void {
    try {
      const kline = data?.k;
      if (!kline || typeof kline !== "object") {
        this.logger.debug("Invalid kline data structure");
        return;
      }

      // Валидация обязательных полей
      if (
        !kline.s || // symbol
        !kline.t || // openTime
        !kline.T || // closeTime
        kline.o === undefined || // open
        kline.h === undefined || // high
        kline.l === undefined || // low
        kline.c === undefined || // close
        kline.v === undefined // volume
      ) {
        this.logger.debug("Kline data missing required fields");
        return;
      }

      const klineData: KlineData = {
        symbol: String(kline.s),
        interval: String(kline.i || "1m"),
        openTime: Number(kline.t),
        closeTime: Number(kline.T),
        open: parseFloat(String(kline.o)),
        high: parseFloat(String(kline.h)),
        low: parseFloat(String(kline.l)),
        close: parseFloat(String(kline.c)),
        volume: parseFloat(String(kline.v)),
        isClosed: Boolean(kline.x),
      };

      // Валидация числовых значений
      if (
        isNaN(klineData.open) ||
        isNaN(klineData.high) ||
        isNaN(klineData.low) ||
        isNaN(klineData.close) ||
        isNaN(klineData.volume)
      ) {
        this.logger.debug("Kline data contains invalid numeric values");
        return;
      }

      if (this.callbacks.onKline) {
        this.callbacks.onKline(klineData);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing kline data: ${errorMessage}`, { error, data });
    }
  }

  /**
   * Обработка агрегированных сделок (aggTrade)
   */
  private handleAggTrade(data: any): void {
    try {
      if (!data || typeof data !== "object") {
        this.logger.debug("Invalid aggTrade data structure");
        return;
      }

      // Валидация обязательных полей
      if (
        !data.s || // symbol
        data.p === undefined || // price
        data.q === undefined || // quantity
        !data.T || // timestamp
        data.m === undefined || // isBuyerMaker
        !data.a // tradeId
      ) {
        this.logger.debug("AggTrade data missing required fields");
        return;
      }

      const price = parseFloat(String(data.p));
      const quantity = parseFloat(String(data.q));

      // Валидация числовых значений
      if (isNaN(price) || isNaN(quantity) || price <= 0 || quantity <= 0) {
        this.logger.debug("AggTrade data contains invalid numeric values");
        return;
      }

      const tradeData: AggTradeData = {
        symbol: String(data.s),
        price: price,
        quantity: quantity,
        timestamp: Number(data.T),
        isBuyerMaker: Boolean(data.m),
        tradeId: Number(data.a),
      };

      if (this.callbacks.onAggTrade) {
        this.callbacks.onAggTrade(tradeData);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing aggTrade data: ${errorMessage}`, { error, data });
    }
  }

  /**
   * Обработка стакана заявок (depth)
   */
  private handleDepth(data: any): void {
    try {
      if (!data || typeof data !== "object") {
        this.logger.debug("Invalid depth data structure");
        return;
      }

      // Валидация обязательных полей
      if (!data.s || !Array.isArray(data.b) || !Array.isArray(data.a) || !data.E) {
        this.logger.debug("Depth data missing required fields");
        return;
      }

      // Валидация и преобразование bids
      const bids: [number, number][] = [];
      for (const bid of data.b) {
        if (!Array.isArray(bid) || bid.length < 2) continue;
        const price = parseFloat(String(bid[0]));
        const quantity = parseFloat(String(bid[1]));
        if (!isNaN(price) && !isNaN(quantity) && price > 0 && quantity > 0) {
          bids.push([price, quantity]);
        }
      }

      // Валидация и преобразование asks
      const asks: [number, number][] = [];
      for (const ask of data.a) {
        if (!Array.isArray(ask) || ask.length < 2) continue;
        const price = parseFloat(String(ask[0]));
        const quantity = parseFloat(String(ask[1]));
        if (!isNaN(price) && !isNaN(quantity) && price > 0 && quantity > 0) {
          asks.push([price, quantity]);
        }
      }

      if (bids.length === 0 && asks.length === 0) {
        this.logger.debug("Depth data contains no valid bids or asks");
        return;
      }

      const depthData: DepthData = {
        symbol: String(data.s),
        bids: bids,
        asks: asks,
        timestamp: Number(data.E),
      };

      if (this.callbacks.onDepth) {
        this.callbacks.onDepth(depthData);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing depth data: ${errorMessage}`, { error, data });
    }
  }

  /**
   * Запуск ping для поддержания соединения
   */
  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, config.websocket.pingInterval);
  }

  /**
   * Остановка ping
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Планирование переподключения
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Уже запланировано
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Max reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection.`
      );
      if (this.callbacks.onError) {
        this.callbacks.onError(
          new Error(
            `Max reconnect attempts (${this.maxReconnectAttempts}) reached`
          )
        );
      }
      return;
    }

    this.reconnectAttempts++;
    // Экспоненциальная задержка с ограничением максимума (30 секунд)
    const baseDelay = config.websocket.reconnectDelay;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    this.logger.info(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      this.connect();
    }, delay);
  }

  /**
   * Сброс счетчика переподключений (вызывается при успешном подключении)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  /**
   * Отключение от WebSocket
   */
  disconnect(): void {
    this.logger.info("Disconnecting WebSocket...");

    // Отменяем запланированное переподключение
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPing();

    if (this.ws) {
      // Удаляем все обработчики для предотвращения утечек памяти
      this.ws.removeAllListeners();
      
      // Закрываем соединение с кодом нормального закрытия
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "Client disconnect");
      }
      
      this.ws = null;
    }

    this.isConnected = false;
    this.resetReconnectAttempts();
    this.logger.info("WebSocket disconnected");
  }

  /**
   * Проверка статуса подключения
   */
  isConnectedStatus(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}
