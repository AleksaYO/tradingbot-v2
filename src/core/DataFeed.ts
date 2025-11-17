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
  private statusTimer: NodeJS.Timeout | null = null;
  private lastKlineTime: number = 0;
  private dataReceivedCount: number = 0;
  private aggTradeCount: number = 0;
  private depthCount: number = 0;

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
        this.aggTradeCount++;
        this.processAggTrade(data);
        // Логируем только периодически, чтобы не засорять логи
        if (this.aggTradeCount % 100 === 0) {
          this.logger.debug(`📈 AggTrade: ${data.price.toFixed(2)} USDT, qty: ${data.quantity.toFixed(4)}`);
        }
        this.emit("marketData", data);
      },
      onDepth: (data: DepthData) => {
        this.depthCount++;
        this.processDepth(data);
        // Логируем только периодически
        if (this.depthCount % 50 === 0) {
          const midPrice = this.getMidPrice();
          this.logger.debug(`📊 Depth update: midPrice=${midPrice?.toFixed(2) || "N/A"} USDT`);
        }
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
    
    // Запускаем периодическое логирование статуса (каждые 5 минут)
    this.startStatusLogging();
  }

  /**
   * Остановка получения данных
   */
  async stop(): Promise<void> {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }
    this.logger.info("DataFeed stopped");
  }

  /**
   * Запуск периодического логирования статуса
   */
  private startStatusLogging(): void {
    // Логируем статус каждые 5 минут
    this.statusTimer = setInterval(() => {
      const midPrice = this.getMidPrice();
      const latestKline = this.getLatestKline();
      const klinesCount = this.klines.length;
      const timeSinceLastKline = this.lastKlineTime > 0 
        ? Math.floor((Date.now() - this.lastKlineTime) / 1000 / 60)
        : null;

      this.logger.info(
        `[STATUS] Bot is running | Price: ${midPrice?.toFixed(2) || "N/A"} USDT | ` +
        `Candles: ${klinesCount} | Klines: ${this.dataReceivedCount} | AggTrades: ${this.aggTradeCount} | Depth: ${this.depthCount} | ` +
        `Last candle: ${timeSinceLastKline !== null ? `${timeSinceLastKline} min ago` : "N/A"}`
      );
    }, 5 * 60 * 1000); // 5 минут

    // Первый статус через 1 минуту после запуска
    setTimeout(() => {
      const midPrice = this.getMidPrice();
      this.logger.info(
        `[STATUS] Bot initialized | Current price: ${midPrice?.toFixed(2) || "waiting for data..."} USDT`
      );
    }, 60 * 1000);
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
    this.dataReceivedCount++;
    
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

    // Логируем все свечи для диагностики
    if (kline.isClosed) {
      this.lastKlineTime = Date.now();
      this.klines.push(kline);

      // Ограничиваем размер массива
      if (this.klines.length > this.maxKlines) {
        this.klines.shift();
      }

      // Логируем закрытые свечи на уровне INFO для видимости
      this.logger.info(
        `📊 Closed candle: ${kline.close.toFixed(2)} USDT | ` +
        `H: ${kline.high.toFixed(2)} L: ${kline.low.toFixed(2)} | ` +
        `Volume: ${kline.volume.toFixed(2)} | Time: ${new Date(kline.closeTime).toLocaleTimeString()}`
      );
    } else {
      // Логируем незакрытые свечи на уровне DEBUG (только периодически)
      if (this.dataReceivedCount % 10 === 0) {
        this.logger.debug(
          `📊 Open candle update: ${kline.close.toFixed(2)} USDT | ` +
          `H: ${kline.high.toFixed(2)} L: ${kline.low.toFixed(2)}`
        );
      }
    }
  }

  /**
   * Обработка агрегированных сделок
   *
   * AggTrade события приходят очень часто (несколько раз в секунду),
   * поэтому не логируем их, чтобы не засорять консоль.
   * Данные используются для анализа, но не требуют логирования.
   */
  private processAggTrade(data: AggTradeData): void {
    // Не логируем AggTrade - это нормальный поток рыночных данных
    // Если нужно отслеживать крупные сделки, можно добавить фильтр:
    // if (data.quantity >= 10.0) {
    //   this.logger.info(`Large trade: ${data.quantity} BTC @ ${data.price}`);
    // }
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
