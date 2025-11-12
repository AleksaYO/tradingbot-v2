# WebSocket Implementation для Binance Futures

## Реализованные WebSocket подключения

### 1. Market Data Streams (публичные данные)
**Файл:** `src/utils/websocket.ts`  
**Класс:** `BinanceWebSocket`

**Endpoint:** `wss://fstream.binance.com/stream?streams=<stream1>/<stream2>/...`

**Поддерживаемые потоки:**
- `aggTrade` - агрегированные сделки: `<symbol>@aggTrade`
- `kline` - свечи: `<symbol>@kline_<interval>` (например, `btcusdt@kline_1m`)
- `depth` - стакан заявок: `<symbol>@depth<levels>@<updateSpeed>` (например, `btcusdt@depth20@100ms`)

**Особенности:**
- ✅ Автоматическое переподключение с экспоненциальной задержкой
- ✅ Ping/pong для поддержания соединения
- ✅ Валидация всех входящих данных
- ✅ Обработка ошибок и таймаутов
- ✅ Защита от утечек памяти
- ✅ Логирование всех событий

**Использование:**
```typescript
const ws = new BinanceWebSocket(
  "BTCUSDT",
  ["kline", "aggTrade", "depth"],
  {
    onKline: (data) => { /* обработка свечей */ },
    onAggTrade: (data) => { /* обработка сделок */ },
    onDepth: (data) => { /* обработка стакана */ },
    onError: (error) => { /* обработка ошибок */ },
    onReconnect: () => { /* переподключение */ },
    onClose: () => { /* закрытие */ },
  },
  logger
);

ws.connect();
```

---

### 2. User Data Stream (приватные данные)
**Файл:** `src/utils/userDataStream.ts`  
**Класс:** `BinanceUserDataStream`

**Endpoint:** `wss://fstream.binance.com/ws/<listenKey>`

**События:**
- `ACCOUNT_UPDATE` - обновление баланса аккаунта
- `ORDER_TRADE_UPDATE` - обновление статуса ордера или позиции
- `MARGIN_CALL` - маржин колл

**Особенности:**
- ✅ Автоматическое получение и обновление listenKey
- ✅ Keep-alive для listenKey (каждые 30 минут)
- ✅ Автоматическое переподключение
- ✅ Обработка всех типов событий
- ✅ Корректное удаление listenKey при отключении

**Использование:**
```typescript
const userStream = new BinanceUserDataStream(
  {
    onAccountUpdate: (data) => { /* обновление баланса */ },
    onOrderUpdate: (data) => { /* обновление ордера */ },
    onPositionUpdate: (data) => { /* обновление позиции */ },
    onMarginCall: (data) => { /* маржин колл */ },
    onError: (error) => { /* обработка ошибок */ },
  },
  logger
);

await userStream.connect();
```

---

## Архитектура

### DataFeed (src/core/DataFeed.ts)
Использует `BinanceWebSocket` для получения рыночных данных:
- Хранит историю свечей в памяти (до 500 свечей)
- Обновляет стакан заявок (order book)
- Эмитит события `marketData` для других компонентов

### Интеграция с ботом
WebSocket подключения инициализируются в `src/index.ts`:
- Market Data Stream запускается автоматически при старте бота
- User Data Stream можно добавить для отслеживания позиций и ордеров

---

## Официальная документация Binance

- **Market Data Streams:** https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams
- **User Data Stream:** https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-stream

---

## Улучшения в реализации

### Market Data Stream:
1. ✅ Полная валидация всех входящих данных
2. ✅ Обработка пустых и некорректных сообщений
3. ✅ Экспоненциальная задержка при переподключении
4. ✅ Ограничение максимального количества попыток переподключения
5. ✅ Корректное закрытие соединения
6. ✅ Удаление всех обработчиков для предотвращения утечек памяти

### User Data Stream:
1. ✅ Автоматическое управление listenKey
2. ✅ Keep-alive механизм
3. ✅ Обработка всех типов событий
4. ✅ Автоматическое переподключение с обновлением listenKey
5. ✅ Корректная очистка ресурсов

---

## Примеры использования

### Получение рыночных данных:
```typescript
// В DataFeed уже реализовано
const dataFeed = new DataFeed(logger);
await dataFeed.start();

dataFeed.on("marketData", (data) => {
  // data может быть KlineData, AggTradeData или DepthData
  console.log("Market data:", data);
});
```

### Отслеживание позиций и ордеров:
```typescript
const userStream = new BinanceUserDataStream(
  {
    onOrderUpdate: (data) => {
      const order = data.o;
      console.log(`Order ${order.s} ${order.S} ${order.X}: ${order.p}`);
    },
    onPositionUpdate: (data) => {
      console.log("Position updated:", data);
    },
  },
  logger
);

await userStream.connect();
```

---

## Рекомендации

1. **Всегда используйте dry-run режим** для тестирования
2. **Мониторьте логи** для отслеживания переподключений
3. **Обрабатывайте все события** для корректной работы бота
4. **Не забывайте отключать** WebSocket при завершении работы
5. **Проверяйте валидность данных** перед использованием

