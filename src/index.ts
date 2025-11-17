import { DataFeed } from "./core/DataFeed";
import { StrategyEngine } from "./core/StrategyEngine";
import { OrderExecutor } from "./core/OrderExecutor";
import { RiskManager } from "./core/RiskManager";
import { Logger } from "./core/Logger";
import { config, Config } from "./core/Config";

/**
 * Интерфейс для управления жизненным циклом бота
 */
interface TradingBotComponents {
  dataFeed: DataFeed;
  strategy: StrategyEngine;
  risk: RiskManager;
  executor: OrderExecutor;
  logger: Logger;
}

/**
 * Глобальная переменная для доступа к components при shutdown
 */
let globalBotComponents: TradingBotComponents | null = null;
let isShuttingDown = false;

/**
 * Главная функция запуска торгового бота
 */
async function main(): Promise<void> {
  const logger = new Logger();

  try {
    // Валидация конфигурации
    if (!config?.trading) {
      throw new Error("Invalid configuration: trading settings not found");
    }

    logger.info("Starting Trading Bot...");

    // Проверка конфигурации для live режима
    if (!config.trading.dryRun) {
      // Дополнительные проверки для live режима
      if (!Config.apiKey || !Config.apiSecret) {
        throw new Error(
          "API keys not configured! Cannot run in LIVE mode without API keys."
        );
      }
      if (
        Config.apiKey === "your_api_key_here" ||
        Config.apiSecret === "your_secret_key_here"
      ) {
        throw new Error(
          "Please configure real API keys in .env file before running in LIVE mode!"
        );
      }
      
      // Проверка формата API ключа (должен быть не пустым и не слишком коротким)
      if (Config.apiKey.length < 20 || Config.apiSecret.length < 20) {
        logger.warn(
          "⚠️  WARNING: API key or secret seems too short. Please verify your API keys are correct."
        );
      }
      
      logger.warn("🚨🚨🚨 LIVE MODE - Real trades will be executed! 🚨🚨🚨");
      logger.warn("⚠️  Make sure you understand the risks!");
      logger.warn("⚠️  IMPORTANT: Ensure your API key has:");
      logger.warn("   - 'Enable Futures' permission enabled");
      logger.warn("   - Your IP address whitelisted (or IP restriction disabled)");
      logger.warn("   - Created as 'Futures API' (not Spot API)");
      logger.warn("⚠️  Starting in 3 seconds... Press Ctrl+C to cancel");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      logger.info("✅ DRY RUN MODE ENABLED - No real trades will be executed");
      if (!Config.apiKey || !Config.apiSecret) {
        logger.warn(
          "⚠️  API keys not configured - WebSocket will work, but trading features disabled"
        );
      }
    }

    // Инициализация компонентов
    const components = initializeComponents(logger);
    globalBotComponents = components; // Сохраняем для доступа при shutdown

    // Настройка обработчиков событий
    setupEventHandlers(components);

    // Запуск получения данных
    await components.dataFeed.start();

    logger.info("Trading Bot started successfully");

    // Ожидание завершения (блокирующий вызов)
    await waitForShutdown();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start Trading Bot: ${errorMessage}`);

    // Корректное завершение при ошибке
    if (globalBotComponents) {
      await shutdown(globalBotComponents);
    }

    process.exit(1);
  }
}

/**
 * Инициализация всех компонентов системы
 */
function initializeComponents(logger: Logger): TradingBotComponents {
  try {
    const dataFeed = new DataFeed(logger);
    const strategy = new StrategyEngine(logger, dataFeed);
    const risk = new RiskManager(logger);
    const executor = new OrderExecutor(logger, risk);

    return { dataFeed, strategy, risk, executor, logger };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize components: ${errorMessage}`);
  }
}

/**
 * Настройка обработчиков событий
 */
function setupEventHandlers(components: TradingBotComponents): void {
  const { dataFeed, strategy, risk, executor, logger } = components;

  // Обработка рыночных данных и генерация торговых сигналов
  dataFeed.on("marketData", (data: unknown) => {
    handleMarketData(data, components).catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Unhandled error in marketData handler: ${errorMessage}`);
    });
  });

  // Обработка ошибок WebSocket
  dataFeed.on("error", (error: Error) => {
    logger.error(`WebSocket error: ${error.message}`);
    // Критические ошибки WebSocket обрабатываются внутри DataFeed
  });

  // Обработка переподключения (если поддерживается)
  if (typeof dataFeed.on === "function") {
    dataFeed.on("reconnect", () => {
      logger.info("WebSocket reconnected successfully");
    });

    // Обработка закрытия соединения
    dataFeed.on("close", () => {
      logger.info("WebSocket connection closed");
    });
  }
}

/**
 * Обработка рыночных данных
 */
async function handleMarketData(
  data: unknown,
  components: TradingBotComponents
): Promise<void> {
  const { strategy, risk, executor, logger, dataFeed } = components;

  try {
    // Валидация данных
    if (!data || typeof data !== "object") {
      logger.debug("Invalid data received (not an object)");
      return; // Пропускаем некорректные данные
    }
    
    // Логируем тип данных для диагностики
    const dataType = "isClosed" in data ? "kline" : "price" in data ? "aggTrade" : "bids" in data ? "depth" : "unknown";
    if (dataType === "kline") {
      logger.debug(`Received ${dataType} data: isClosed=${(data as any).isClosed}`);
    }

    // Проверяем открытые позиции в DRY RUN режиме при получении новых данных
    if (Config.dryRun) {
      let currentPrice: number | null = null;
      let high: number | undefined = undefined;
      let low: number | undefined = undefined;

      // Извлекаем цену из данных
      if ("close" in data && typeof (data as any).close === "number") {
        currentPrice = (data as any).close;
        if ("high" in data && typeof (data as any).high === "number") {
          high = (data as any).high;
        }
        if ("low" in data && typeof (data as any).low === "number") {
          low = (data as any).low;
        }
      } else if ("price" in data && typeof (data as any).price === "number") {
        currentPrice = (data as any).price;
      } else if (dataFeed) {
        currentPrice = dataFeed.getMidPrice();
      }

      if (currentPrice !== null) {
        const statsBefore = executor.getDryRunStats();
        executor.checkDryRunPositions(currentPrice, high, low);
        const statsAfter = executor.getDryRunStats();
        
        // Логируем статус позиций при изменении количества
        if (statsAfter.openPositions !== statsBefore.openPositions) {
          if (statsAfter.openPositions > 0) {
            const positions = statsAfter.positions.map(p => {
              const pnl = p.positionSide === "LONG" 
                ? (currentPrice - p.entryPrice) * p.quantity
                : (p.entryPrice - currentPrice) * p.quantity;
              const pnlPercent = p.positionSide === "LONG"
                ? ((currentPrice - p.entryPrice) / p.entryPrice) * 100
                : ((p.entryPrice - currentPrice) / p.entryPrice) * 100;
              return `${p.positionSide} @ ${p.entryPrice.toFixed(2)} (PnL: ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} USDT, ${pnlPercent > 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`;
            }).join(" | ");
            logger.info(
              `[DRY RUN] Open positions: ${statsAfter.openPositions} | ${positions} | Current price: ${currentPrice.toFixed(2)}`
            );
          } else {
            logger.info(`[DRY RUN] All positions closed`);
          }
        } else if (statsAfter.openPositions > 0 && Math.random() < 0.05) { // 5% шанс периодического логирования
          const positions = statsAfter.positions.map(p => {
            const pnl = p.positionSide === "LONG" 
              ? (currentPrice - p.entryPrice) * p.quantity
              : (p.entryPrice - currentPrice) * p.quantity;
            return `${p.positionSide} @ ${p.entryPrice.toFixed(2)} (PnL: ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} USDT)`;
          }).join(" | ");
          logger.debug(
            `[DRY RUN] Tracking ${statsAfter.openPositions} position(s): ${positions} | Current price: ${currentPrice.toFixed(2)}`
          );
        }
      }
    }

    // Логируем все входящие данные для диагностики (только для kline)
    if ("isClosed" in data && "symbol" in data) {
      const klineData = data as any;
      if (klineData.isClosed) {
        logger.info(
          `📊 Processing closed candle: ${klineData.close.toFixed(2)} USDT | ` +
          `Time: ${new Date(klineData.closeTime).toLocaleTimeString()}`
        );
      } else {
        logger.debug(
          `📊 Received open candle update: ${klineData.close.toFixed(2)} USDT`
        );
      }
    }

    // Обрабатываем только закрытые свечи для генерации сигналов
    // (kline с isClosed=true)
    if ("isClosed" in data && !(data as any).isClosed) {
      logger.debug("Skipping open candle (waiting for closed candle)");
      return; // Пропускаем незакрытые свечи для генерации сигналов
    }

    // Генерация сигнала (только для закрытых свечей или данных без isClosed)
    logger.info(`🔍 Calling strategy.process() for closed candle`);
    const signal = strategy.process(data);
    if (!signal) {
      // Логируем только периодически, чтобы не засорять логи
      if (Math.random() < 0.05) { // 5% шанс
        logger.debug("No signal generated by strategy (this is normal)");
      }
      return; // Нет сигнала - это нормально
    }

    logger.info(`✅ Signal generated: ${JSON.stringify(signal)}`);

    // Валидация сигнала через риск-менеджер
    logger.debug("Validating signal through risk manager...");
    const validatedSignal = risk.validateSignal(signal);
    if (!validatedSignal) {
      logger.warn("❌ Signal rejected by risk manager");
      return;
    }
    logger.info(`✅ Signal validated by risk manager`);

    // Преобразуем signal в формат для OrderExecutor (side вместо type)
    const executorSignal: any = {
      side: (validatedSignal.type === "LONG" ? "BUY" : "SELL") as
        | "BUY"
        | "SELL",
      size: (validatedSignal as any).quantity || Config.risk.maxPositionSize,
      price: validatedSignal.entryPrice,
      stopLoss: validatedSignal.stopLoss,
      takeProfit: validatedSignal.takeProfit,
      // Сохраняем остальные поля из validatedSignal
      symbol: validatedSignal.symbol,
      confidence: validatedSignal.confidence,
      reason: validatedSignal.reason,
    };

    // Исполнение сигнала
    await executor.execute(executorSignal);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing market data: ${errorMessage}`, {
      error: error instanceof Error ? error.stack : String(error),
    });
    // Не прерываем работу бота из-за ошибки обработки одного сообщения
  }
}

/**
 * Ожидание сигнала завершения
 */
function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    // Promise будет разрешен при получении сигнала завершения
    // Обработчики сигналов настроены ниже и вызовут shutdown
    // Для бесконечного ожидания просто не вызываем resolve
  });
}

/**
 * Корректное завершение работы всех компонентов
 */
async function shutdown(components: TradingBotComponents): Promise<void> {
  const { dataFeed, logger } = components;

  if (isShuttingDown) {
    return; // Уже идет процесс завершения
  }

  isShuttingDown = true;
  logger.info("Shutting down Trading Bot...");

  try {
    // Остановка DataFeed
    if (dataFeed) {
      await dataFeed.stop();
    }

    // Удаление всех обработчиков событий для предотвращения утечек памяти
    dataFeed.removeAllListeners();

    logger.info("Trading Bot stopped successfully");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error during shutdown: ${errorMessage}`);
  }
}

/**
 * Обработка сигналов завершения
 */
async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  if (globalBotComponents) {
    await shutdown(globalBotComponents);
  }

  process.exit(0);
}

// Обработка сигналов завершения
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

// Обработка необработанных ошибок
process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    if (globalBotComponents?.logger) {
      globalBotComponents.logger.error(
        `Unhandled rejection: ${String(reason)}`
      );
    }
    // В production можно добавить отправку в систему мониторинга
  }
);

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught Exception:", error);
  if (globalBotComponents?.logger) {
    globalBotComponents.logger.error(`Uncaught exception: ${error.message}`);
  }
  // Критическая ошибка - завершаем процесс
  process.exit(1);
});

// Запуск приложения
main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
