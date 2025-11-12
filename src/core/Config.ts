import * as dotenv from "dotenv";

dotenv.config();

export interface RiskConfig {
  maxDailyLoss: number; // долларовый лимит
  maxPositionSize: number; // в BTC (или другой валюте символа)
  stopLossPercent: number; // проценты
  takeProfitPercent: number; // проценты
}

export interface Config {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  leverage: number;
  risk: RiskConfig;
  // Дополнительные параметры для обратной совместимости
  dryRun?: boolean;
  websocket?: {
    reconnectDelay: number;
    pingInterval: number;
  };
  logging?: {
    level: string;
    file: string;
  };
}

export const Config: Config = {
  apiKey: process.env.BINANCE_KEY || process.env.BINANCE_API_KEY || "",
  apiSecret: process.env.BINANCE_SECRET || process.env.BINANCE_SECRET_KEY || "",
  symbol: process.env.SYMBOL || "BTCUSDT",
  leverage: parseInt(process.env.LEVERAGE || "20", 10),
  risk: {
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || "50"),
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || "0.02"),
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || "0.5"),
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || "1.2"),
  },
  dryRun: process.env.DRY_RUN === "true",
  websocket: {
    reconnectDelay: parseInt(process.env.WS_RECONNECT_DELAY || "5000", 10),
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || "30000", 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "logs/tradingbot.log",
  },
};

// Экспортируем как config для обратной совместимости
export const config = {
  // Новая структура
  ...Config,
  // Старая структура для обратной совместимости
  binance: {
    apiKey: Config.apiKey,
    secretKey: Config.apiSecret,
    futuresBaseUrl: "https://fapi.binance.com",
    wsBaseUrl: "wss://fstream.binance.com",
  },
  trading: {
    symbol: Config.symbol,
    dryRun: Config.dryRun ?? true,
    maxPositionSize: Config.risk.maxPositionSize,
    maxLossPerDay: Config.risk.maxDailyLoss,
    stopLossPercent: Config.risk.stopLossPercent,
    takeProfitPercent: Config.risk.takeProfitPercent,
    leverage: Config.leverage,
  },
  websocket: Config.websocket || {
    reconnectDelay: 5000,
    pingInterval: 30000,
  },
  logging: Config.logging || {
    level: "info",
    file: "logs/tradingbot.log",
  },
};
