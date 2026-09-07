# First prompt for Cursor Agent

Ты начинаешь реализацию нового проекта **Vimla** с нуля.

Vimla — глобальный consumer/prosumer AI workspace: один аккаунт, один интерфейс и единая система Usage для работы с несколькими AI-моделями и возможностями. На первом этапе AI-доступ будет идти через ProxyAPI, но архитектура не должна быть жёстко привязана к ProxyAPI.

Перед написанием кода сначала полностью изучи и используй как источник истины:
- `AGENTS.md`
- все релевантные `.cursor/rules/*.mdc`
- `docs/PROJECT.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`

Если между текущими файлами репозитория и документацией есть конфликт, не удаляй полезные файлы молча. Сначала определи конфликт и аккуратно мигрируй решение к архитектуре Vimla.

## Текущая задача
Реализуй **только Phase 0 — Repository foundation** из `docs/IMPLEMENTATION_PLAN.md` и минимальный безопасный skeleton, необходимый для начала Phase 1.

Не реализуй сейчас:
- настоящие платежи;
- ProxyAPI вызовы;
- OpenAI/Anthropic/Google SDK;
- Billing/Usage Engine целиком;
- изображения;
- видео;
- Auto Router;
- проекты;
- агентов.

Не перескакивай на более поздние фазы roadmap.

## Обязательный стек
Frontend:
- Next.js 16 App Router
- React 19
- TypeScript strict
- MobX
- SCSS Modules

Backend:
- Node.js 24 LTS
- TypeScript strict
- NestJS
- Fastify adapter

Worker:
- Node.js 24 LTS
- TypeScript strict
- BullMQ

Infrastructure:
- PostgreSQL
- Prisma
- Redis
- Docker Compose
- pnpm workspaces
- Turborepo

## Создай monorepo
```text
apps/
  web/
  api/
  worker/

packages/
  contracts/
  database/
  config/
  ai/
  billing/
  shared/
```

## В рамках этого прохода
1. Инициализируй pnpm workspace и Turborepo.
2. Создай `apps/web` на Next.js 16 + React 19.
3. Создай `apps/api` на NestJS + Fastify.
4. Создай `apps/worker` с фундаментом BullMQ.
5. Создай перечисленные shared packages.
6. Настрой TypeScript strict для всего monorepo.
7. Настрой PostgreSQL + Prisma foundation.
8. Настрой Redis foundation.
9. Создай Docker Compose для локальной разработки.
10. Добавь typed environment configuration. Не допускай разбросанного прямого `process.env` по приложению.
11. Создай `.env.example` без секретов.
12. Добавь API endpoint `GET /health`.
13. Сделай возможность web-приложению обращаться к backend health через конфигурируемый public API base URL.
14. Добавь базовое подключение worker к Redis.
15. Добавь структурированное логирование через Pino или совместимую NestJS-интеграцию.
16. Добавь root-команды:
```text
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```
17. Создай минимальную тестовую инфраструктуру и smoke tests там, где они полезны для проверки foundation.
18. Добавь `.gitignore`.
19. Создай root `README.md` с точными командами установки, env setup, Docker services, запуска, тестов, lint, typecheck и build.
20. Добавь базовый CI pipeline:
```text
install -> lint -> typecheck -> test -> build
```

## Архитектурные ограничения
Не создавай микросервисы.

Используется:
```text
modular monolith API
+
separate worker process
```

Не добавляй без необходимости:
- Kubernetes;
- Kafka;
- RabbitMQ;
- event sourcing framework;
- CQRS framework;
- payment SDK;
- ProxyAPI SDK;
- OpenAI SDK;
- Anthropic SDK;
- Google AI SDK;
- media-generation integration.

Архитектура должна быть подготовлена к будущей критической цепочке:
```text
Payment
  -> Usage Bucket
  -> Reservation
  -> AI Gateway
  -> Provider
  -> Actual Cost
  -> Settlement
  -> Usage Ledger
```

Но сам billing engine в этом проходе не реализовывай.

PostgreSQL в будущем является источником истины для:
- payments;
- subscriptions;
- usage;
- reservations;
- ledger;
- provider-cost accounting.

Redis предназначен для:
- queues;
- cache;
- rate limits;
- временной coordination.

Redis не является источником истины для денег или пользовательского allowance.

## Важные правила качества
- Не используй `any`.
- Не ослабляй TypeScript strict.
- Не используй floating-point arithmetic для будущих денежных сущностей.
- Не помещай backend secrets в frontend.
- Не создавай глобальное mutable state.
- Соблюдай scoped frontend rules из `.cursor/rules/10-frontend.mdc`.
- Не добавляй Pixi.js или editor/constraint-layout архитектуру: она относилась к другому проекту и не является частью Vimla.

## Перед завершением
Запусти:
```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Исправь все ошибки, возникшие из-за текущей реализации.

После этого:
1. перечисли созданные приложения и packages;
2. покажи итоговую структуру репозитория;
3. перечисли Docker services;
4. перечисли environment variables;
5. дай точные команды локального запуска;
6. сообщи результаты lint/typecheck/test/build;
7. обнови `docs/IMPLEMENTATION_PLAN.md`, отметив только реально выполненные задачи Phase 0;
8. перечисли технический долг/открытые вопросы, но не реализуй следующие фазы без отдельной команды.

Главный приоритет текущего прохода: создать чистый, типобезопасный и расширяемый фундамент Vimla, на котором затем можно безопасно реализовать Billing/Usage Engine и ProxyAPI.
