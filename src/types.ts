/**
 * Типы данных для WebSocket сообщений от Binance Futures
 */

export interface KlineData {
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface AggTradeData {
  symbol: string;
  price: number;
  quantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
  tradeId: number;
}

export interface DepthData {
  symbol: string;
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][];
  timestamp: number;
}

export interface OrderBook {
  bids: Map<number, number>; // price -> quantity
  asks: Map<number, number>;
  lastUpdate: number;
}

export interface Position {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

export interface Signal {
  type: "LONG" | "SHORT";
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number; // 0-1
  reason: string;
}

export interface Order {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
  timestamp: number;
}

export interface FVG {
  high: number;
  low: number;
  type: "BULLISH" | "BEARISH";
  timestamp: number;
  filled: boolean;
}

export interface LiquidityZone {
  price: number;
  type: "SUPPORT" | "RESISTANCE";
  strength: number; // 0-1
  timestamp: number;
}
