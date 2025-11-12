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
      logger.warn("🚨🚨🚨 LIVE MODE - Real trades will be executed! 🚨🚨🚨");
      logger.warn("⚠️  Make sure you understand the risks!");
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
  const { strategy, risk, executor, logger } = components;

  try {
    // Валидация данных
    if (!data || typeof data !== "object") {
      return; // Пропускаем некорректные данные
    }

    // Обрабатываем только закрытые свечи для оптимизации
    // (kline с isClosed=true или новые свечи)
    if ("isClosed" in data && !(data as any).isClosed) {
      return; // Пропускаем незакрытые свечи
    }

    // Генерация сигнала
    const signal = strategy.process(data);
    if (!signal) {
      return; // Нет сигнала - это нормально
    }

    logger.info(`Signal generated: ${JSON.stringify(signal)}`);

    // Валидация сигнала через риск-менеджер
    const validatedSignal = risk.validateSignal(signal);
    if (!validatedSignal) {
      logger.info("Signal rejected by risk manager");
      return;
    }

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
