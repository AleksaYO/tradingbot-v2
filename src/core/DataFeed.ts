import EventEmitter from "events";
import { BinanceWebSocket, StreamCallbacks } from "../utils/websocket";
import { config } from "./Config";
import { Logger } from "./Logger";
import { KlineData, AggTradeData, DepthData, OrderBook } from "../types";

/**
 * DataFeed - модуль для получения рыночных данных через WebSocket
 */
export class DataFeed extends EventEmitter {
  private ws: BinanceWebSocket | null = null;
  private logger: Logger;
  private klines: KlineData[] = [];
  private orderBook: OrderBook;
  private maxKlines: number = 500;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.orderBook = {
      bids: new Map(),
      asks: new Map(),
      lastUpdate: 0,
    };
  }

  /**
   * Запуск получения данных
   */
  async start(): Promise<void> {
    const symbol = config.trading.symbol;
    const streams: ("aggTrade" | "kline" | "depth")[] = [
      "kline",
      "aggTrade",
      "depth",
    ];

    const callbacks: StreamCallbacks = {
      onKline: (data: KlineData) => {
        this.processKline(data);
        this.emit("marketData", data);
      },
      onAggTrade: (data: AggTradeData) => {
        this.processAggTrade(data);
        this.emit("marketData", data);
      },
      onDepth: (data: DepthData) => {
        this.processDepth(data);
        this.emit("marketData", data);
      },
      onError: (error: Error) => {
        this.logger.error(`DataFeed error: ${error.message}`);
        this.emit("error", error);
      },
      onReconnect: () => {
        this.logger.info("DataFeed reconnected");
        this.emit("reconnect");
      },
      onClose: () => {
        this.logger.warn("DataFeed connection closed");
        this.emit("close");
      },
    };

    this.ws = new BinanceWebSocket(symbol, streams, callbacks, this.logger);
    this.ws.connect();

    this.logger.info("DataFeed started");
  }

  /**
   * Остановка получения данных
   */
  async stop(): Promise<void> {
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }
    this.logger.info("DataFeed stopped");
  }

  /**
   * Отключение (алиас для stop)
   */
  async disconnect(): Promise<void> {
    await this.stop();
  }

  /**
   * Обработка данных свечей
   */
  private processKline(data: KlineData): void {
    const kline: KlineData = {
      symbol: data.symbol,
      interval: data.interval,
      openTime: data.openTime,
      closeTime: data.closeTime,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
      isClosed: data.isClosed,
    };

    // Добавляем только закрытые свечи для анализа
    if (kline.isClosed) {
      this.klines.push(kline);

      // Ограничиваем размер массива
      if (this.klines.length > this.maxKlines) {
        this.klines.shift();
      }

      this.logger.debug(
        `Processed closed kline: ${kline.close} at ${new Date(
          kline.closeTime
        ).toISOString()}`
      );
    }
  }

  /**
   * Обработка агрегированных сделок
   */
  private processAggTrade(data: AggTradeData): void {
    // Можно использовать для анализа объема и импульса
    this.logger.debug(
      `AggTrade: ${data.price} x ${data.quantity} (${
        data.isBuyerMaker ? "SELL" : "BUY"
      })`
    );
  }

  /**
   * Обработка стакана заявок
   */
  private processDepth(data: DepthData): void {
    // Обновляем order book
    this.orderBook.bids.clear();
    this.orderBook.asks.clear();

    data.bids.forEach(([price, quantity]: [number, number]) => {
      if (quantity > 0) {
        this.orderBook.bids.set(price, quantity);
      }
    });

    data.asks.forEach(([price, quantity]: [number, number]) => {
      if (quantity > 0) {
        this.orderBook.asks.set(price, quantity);
      }
    });

    this.orderBook.lastUpdate = data.timestamp;
  }

  /**
   * Получение истории свечей
   */
  getKlines(count?: number): KlineData[] {
    if (count) {
      return this.klines.slice(-count);
    }
    return [...this.klines];
  }

  /**
   * Получение стакана заявок
   */
  getOrderBook(): OrderBook {
    return {
      bids: new Map(this.orderBook.bids),
      asks: new Map(this.orderBook.asks),
      lastUpdate: this.orderBook.lastUpdate,
    };
  }

  /**
   * Получение последней свечи
   */
  getLatestKline(): KlineData | null {
    return this.klines.length > 0 ? this.klines[this.klines.length - 1] : null;
  }

  /**
   * Получение лучшей цены покупки
   */
  getBestBid(): number | null {
    if (this.orderBook.bids.size === 0) return null;
    return Math.max(...Array.from(this.orderBook.bids.keys()));
  }

  /**
   * Получение лучшей цены продажи
   */
  getBestAsk(): number | null {
    if (this.orderBook.asks.size === 0) return null;
    return Math.min(...Array.from(this.orderBook.asks.keys()));
  }

  /**
   * Получение средней цены
   */
  getMidPrice(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }
}
