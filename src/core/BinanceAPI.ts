/**
 * BinanceAPI.ts
 *
 * REST API клиент для Binance Futures USDT-M
 *
 * Официальная документация:
 * https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api
 *
 * Base URL: https://fapi.binance.com
 */

import axios, { AxiosInstance } from "axios";
import { config } from "./Config";
import { Logger } from "./Logger";
// @ts-ignore - встроенный модуль Node.js
import { createHmac } from "crypto";

export interface BinanceOrder {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity?: number;
  price?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
  reduceOnly?: boolean;
  closePosition?: boolean;
  positionSide?: "LONG" | "SHORT" | "BOTH";
  stopPrice?: number;
  workingType?: "MARK_PRICE" | "CONTRACT_PRICE";
}

export interface BinanceOrderResponse {
  orderId: number;
  symbol: string;
  status: string;
  clientOrderId: string;
  price: string;
  avgPrice: string;
  origQty: string;
  executedQty: string;
  cumQuote: string;
  timeInForce: string;
  type: string;
  reduceOnly: boolean;
  closePosition: boolean;
  side: string;
  positionSide: string;
  stopPrice: string;
  workingType: string;
  priceProtect: boolean;
  origType: string;
  time: number;
  updateTime: number;
}

export interface BinancePosition {
  symbol: string;
  initialMargin: string;
  maintMargin: string;
  unrealizedProfit: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  leverage: string;
  isolated: boolean;
  entryPrice: string;
  maxNotional: string;
  bidNotional: string;
  askNotional: string;
  positionSide: string;
  positionAmt: string;
  updateTime: number;
}

export interface BinanceAccountInfo {
  assets: Array<{
    asset: string;
    walletBalance: string;
    unrealizedProfit: string;
    marginBalance: string;
    maintMargin: string;
    initialMargin: string;
    positionInitialMargin: string;
    openOrderInitialMargin: string;
    maxWithdrawAmount: string;
    crossWalletBalance: string;
    crossUnPnl: string;
    availableBalance: string;
    marginAvailable: boolean;
    updateTime: number;
  }>;
  positions: BinancePosition[];
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  totalInitialMargin: string;
  totalMaintMargin: string;
  totalPositionInitialMargin: string;
  totalOpenOrderInitialMargin: string;
  totalCrossWalletBalance: string;
  totalCrossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTime: number;
}

/**
 * REST API клиент для Binance Futures
 */
export class BinanceAPI {
  private api: AxiosInstance;
  private logger: Logger;
  private apiKey: string;
  private secretKey: string;
  private baseURL: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.apiKey = config.binance.apiKey;
    this.secretKey = config.binance.secretKey;
    this.baseURL = config.binance.futuresBaseUrl;

    // Создаем axios instance с базовыми настройками
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        "X-MBX-APIKEY": this.apiKey,
        "Content-Type": "application/json",
      },
    });

    // Добавляем interceptor для логирования
    this.api.interceptors.request.use(
      (requestConfig: any) => {
        this.logger.debug(
          `API Request: ${requestConfig.method?.toUpperCase()} ${
            requestConfig.url
          }`
        );
        return requestConfig;
      },
      (error: any) => {
        this.logger.error(`API Request Error: ${error.message}`);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response: any) => {
        this.logger.debug(
          `API Response: ${response.status} ${response.config.url}`
        );
        return response;
      },
      (error: any) => {
        this.logger.error(
          `API Response Error: ${error.response?.status} ${
            error.response?.data?.msg || error.message
          }`
        );
        return Promise.reject(error);
      }
    );
  }

  /**
   * Генерация подписи для запроса
   */
  private generateSignature(queryString: string): string {
    return createHmac("sha256", this.secretKey)
      .update(queryString)
      .digest("hex");
  }

  /**
   * Создание query string с подписью
   * 
   * Важно: параметры должны быть отсортированы по алфавиту для правильной подписи
   */
  private createSignedQuery(params: Record<string, any>): string {
    const timestamp = Date.now();
    const recvWindow = 5000; // Окно приема запросов (5 секунд)

    // Добавляем обязательные параметры
    const allParams: Record<string, any> = {
      ...params,
      recvWindow,
      timestamp,
    };

    // Сортируем параметры по алфавиту (требование Binance API)
    const sortedKeys = Object.keys(allParams).sort();
    
    // Создаем query string из отсортированных параметров
    const queryParts: string[] = [];
    for (const key of sortedKeys) {
      const value = allParams[key];
      if (value !== undefined && value !== null) {
        queryParts.push(`${key}=${value}`);
      }
    }

    const queryString = queryParts.join("&");
    const signature = this.generateSignature(queryString);

    return `${queryString}&signature=${signature}`;
  }

  /**
   * Получение информации об аккаунте
   */
  async getAccountInfo(): Promise<BinanceAccountInfo> {
    try {
      const queryString = this.createSignedQuery({});
      const response = await this.api.get(`/fapi/v2/account?${queryString}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get account info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получение открытых позиций
   */
  async getPositions(symbol?: string): Promise<BinancePosition[]> {
    try {
      const params: Record<string, any> = {};
      if (symbol) {
        params.symbol = symbol;
      }

      const queryString = this.createSignedQuery(params);
      const response = await this.api.get(
        `/fapi/v2/positionRisk?${queryString}`
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get positions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Создание нового ордера
   */
  async createOrder(order: BinanceOrder): Promise<BinanceOrderResponse> {
    try {
      const params: Record<string, any> = {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
      };

      if (order.quantity) {
        params.quantity = order.quantity;
      }

      if (order.price) {
        params.price = order.price;
      }

      if (order.timeInForce) {
        params.timeInForce = order.timeInForce;
      }

      if (order.reduceOnly !== undefined) {
        params.reduceOnly = order.reduceOnly;
      }

      if (order.closePosition !== undefined) {
        params.closePosition = order.closePosition;
      }

      if (order.positionSide) {
        params.positionSide = order.positionSide;
      }

      if (order.stopPrice) {
        params.stopPrice = order.stopPrice;
      }

      if (order.workingType) {
        params.workingType = order.workingType;
      }

      const queryString = this.createSignedQuery(params);
      const response = await this.api.post(`/fapi/v1/order?${queryString}`);

      this.logger.info(
        `Order created: ${order.side} ${order.type} ${order.symbol} ${
          order.quantity || ""
        } @ ${order.price || "MARKET"}`
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to create order: ${error.response?.data?.msg || error.message}`,
        { order, error: error.response?.data }
      );
      throw error;
    }
  }

  /**
   * Отмена ордера
   */
  async cancelOrder(
    symbol: string,
    orderId?: number,
    origClientOrderId?: string
  ): Promise<any> {
    try {
      const params: Record<string, any> = { symbol };

      if (orderId) {
        params.orderId = orderId;
      }

      if (origClientOrderId) {
        params.origClientOrderId = origClientOrderId;
      }

      const queryString = this.createSignedQuery(params);
      const response = await this.api.delete(`/fapi/v1/order?${queryString}`);

      this.logger.info(
        `Order cancelled: ${symbol} ${orderId || origClientOrderId}`
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to cancel order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получение статуса ордера
   */
  async getOrderStatus(
    symbol: string,
    orderId?: number,
    origClientOrderId?: string
  ): Promise<BinanceOrderResponse> {
    try {
      const params: Record<string, any> = { symbol };

      if (orderId) {
        params.orderId = orderId;
      }

      if (origClientOrderId) {
        params.origClientOrderId = origClientOrderId;
      }

      const queryString = this.createSignedQuery(params);
      const response = await this.api.get(`/fapi/v1/order?${queryString}`);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get order status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Закрытие позиции (market ордер в противоположную сторону)
   */
  async closePosition(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number
  ): Promise<BinanceOrderResponse> {
    try {
      // Получаем текущую позицию
      const positions = await this.getPositions(symbol);
      const position = positions.find(
        (p) => p.symbol === symbol && parseFloat(p.positionAmt) !== 0
      );

      if (!position) {
        throw new Error(`No open position found for ${symbol}`);
      }

      const positionAmt = parseFloat(position.positionAmt);
      const closeQuantity = Math.abs(positionAmt);

      // Создаем market ордер для закрытия
      const order: BinanceOrder = {
        symbol,
        side: positionAmt > 0 ? "SELL" : "BUY", // Противоположная сторона
        type: "MARKET",
        quantity: closeQuantity,
        reduceOnly: true,
      };

      return await this.createOrder(order);
    } catch (error: any) {
      this.logger.error(`Failed to close position: ${error.message}`);
      throw error;
    }
  }

  /**
   * Проверка валидности API ключей
   */
  async validateCredentials(): Promise<boolean> {
    try {
      await this.getAccountInfo();
      return true;
    } catch (error: any) {
      this.logger.error(`Invalid API credentials: ${error.message}`);
      return false;
    }
  }
}
