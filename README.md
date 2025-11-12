# Trading Bot v2 - Binance Futures USDT-M

Торговый бот для Binance Futures USDT-M с использованием стратегии Smart Money Concept (SMC).

## Особенности

- WebSocket подключение к Binance Futures (aggTrade, kline, depth)
- Стратегия на основе SMC, FVG (Fair Value Gap) и анализа ликвидности
- Управление рисками (стопы, размер позиции, максимальный убыток в день)
- Поддержка market и limit ордеров
- Логирование в файл
- Dry-run режим для тестирования

## Установка

```bash
npm install
```

## Настройка

1. Скопируйте `env.example` в `.env`:
   ```bash
   cp env.example .env
   ```

2. Заполните API ключи Binance в файле `.env`:
   - `BINANCE_API_KEY` - ваш API ключ
   - `BINANCE_SECRET_KEY` - ваш секретный ключ

3. Настройте параметры торговли:
   - `SYMBOL` - торговая пара (по умолчанию BTCUSDT)
   - `DRY_RUN` - режим тестирования (true/false)
   - `MAX_POSITION_SIZE` - максимальный размер позиции в USDT
   - `MAX_LOSS_PER_DAY` - максимальный убыток за день в USDT
   - `STOP_LOSS_PERCENT` - процент стоп-лосса
   - `TAKE_PROFIT_PERCENT` - процент тейк-профита

## Запуск

```bash
# Разработка
npm run dev

# Продакшн
npm run build
npm start
```

## Структура проекта

```
src/
├── index.ts              # Главный файл запуска
├── types.ts              # TypeScript типы и интерфейсы
├── core/                 # Основные компоненты
│   ├── Config.ts         # Загрузка конфигурации из .env
│   ├── Logger.ts         # Логирование в файл
│   ├── DataFeed.ts       # WebSocket подключение и парсинг данных
│   ├── StrategyEngine.ts # Движок стратегий
│   ├── RiskManager.ts    # Управление рисками
│   └── OrderExecutor.ts  # Исполнение ордеров
├── utils/                # Утилиты
│   ├── websocket.ts      # WebSocket клиент для Binance
│   ├── math.ts           # Математические функции (SMA, EMA и т.д.)
│   └── time.ts           # Утилиты для работы со временем
└── strategies/           # Торговые стратегии
    └── smc.ts            # Стратегия Smart Money Concept

test/
└── strategy.test.ts      # Тесты стратегий
```

## Компоненты

### WebSocket клиент
Использует официальные WebSocket endpoints Binance Futures USDT-M:

**Market Data Streams (публичные данные):**
- Endpoint: `wss://fstream.binance.com/stream`
- Документация: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams
- Потоки данных:
  - `aggTrade` - агрегированные сделки (`<symbol>@aggTrade`)
  - `kline` - свечи (`<symbol>@kline_<interval>`)
  - `depth` - стакан заявок (`<symbol>@depth<levels>@<updateSpeed>`)

**User Data Stream (приватные данные):**
- Endpoint: `wss://fstream.binance.com/ws/<listenKey>`
- Документация: https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-stream
- Используется для получения обновлений о позициях и ордерах

### Strategy Engine
Реализует стратегию Smart Money Concept:
- **SMC анализ** - определение тренда на основе SMA и объема
- **FVG (Fair Value Gap)** - обнаружение и использование ценовых разрывов
- **Анализ ликвидности** - определение зон поддержки/сопротивления и пробитий

### Risk Manager
Управление рисками:
- Проверка максимального убытка за день
- Расчет размера позиции на основе риска
- Валидация стоп-лоссов и тейк-профитов
- Отслеживание открытых позиций

### Order Executor
Исполнение ордеров:
- Поддержка market и limit ордеров
- Dry-run режим для тестирования
- Интеграция с Risk Manager

## Важные замечания

⚠️ **ВНИМАНИЕ**: По умолчанию бот работает в режиме `DRY_RUN=true`. Это означает, что реальные сделки не будут выполняться. Для реальной торговли установите `DRY_RUN=false` в файле `.env`.

⚠️ **Безопасность**: Никогда не публикуйте файл `.env` с вашими API ключами!

## Логирование

Логи сохраняются в файл, указанный в `LOG_FILE` (по умолчанию `logs/tradingbot.log`). Уровень логирования настраивается через `LOG_LEVEL` (debug, info, warn, error).

