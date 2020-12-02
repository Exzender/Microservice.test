# Microservice test app

## Задача

Релизовать микросервис на Node.JS со следующими функциями:
- **1** Подписаться по сокетам к ноде Ethereum.
- **2** Получать новые блоки с транзакциями и кешировать последние 100 блоков.
- **3** Сделать REST endpoints:
- для получения блока по blockNum
- для получения транзакции по transactionId
- Полученные данные должны кешироваться на 1 час после последнего запроса.
- **4** Сделать websocket endpoint с возможностью подписки на отслеживание транзакций по определенному адресу.
- **5** Реализовать graceful shutdown сервиса.

## Комментарии

- Микросервис - на базе RabbitMQ
- Доступ к ETH - web3.js
- Не уверен, что правильно интерпретировал условие хранения кэшированных данных на 1 час
- Кэш - MongoDB (это скорее proof of concept, чем полноценный кэш, 
можно было и в памяти на Map'ах реализовать или на Redis)
- Redis не использован по техническим прчинам - не установлен / не настроен, и нет опыта - 
поэтому в силу ограничений по времени не стал связываться с незнакомой технологией