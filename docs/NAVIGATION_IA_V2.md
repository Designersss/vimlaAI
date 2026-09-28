# Vimla Navigation IA v2 — historical Web IA

> **Current architecture note (2026-09-28):** Vimla is now messenger-first and multi-client by design. GitHub #78 and `docs/MESSENGER_PLATFORM_ARCHITECTURE.md` are the product/platform source of truth; `docs/CLIENT_ARCHITECTURE.md` and `docs/REALTIME_SYNC.md` define future-client and delivery boundaries. Existing implementation details in this document remain valid unless they conflict with those sources.

> This file documents the **pre-pivot Web route/navigation implementation** and is retained for migration/reference. It is not the final messenger IA and must not be used to decide placement of new Channels/Groups/native surfaces. The owner will manually finalize Web layout after #122. New backend/domain work uses semantic NavigationTarget (#91), while final visual/navigation placement is a presentation decision.


## Global

- Сообщения
- Мои дела
- Проекты
- ◆ Vimla
- Настройки

`Главная` may be added only when Vimla Home is actually implemented.

## Сообщения

Canonical future IA:
- Все
- ИИ
- Личные

Pinned/Folders/Unread are local filters or sections. Project chats remain inside Projects.

Phase 6.1 MUST NOT invent Direct Chat backend/data if it does not exist yet. The future Direct state may exist only in dev/reference components or behind a genuine feature flag.

## Мои дела

- Сегодня
- Задачи
- Напоминания
- Списки
- Заметки

## Проекты

Project collection (`/projects`) -> Project detail (`/projects/:id`). Local nav: Overview / Chats / Work / Context / Members. Chats, Work and Context are disabled until their domain phases. Feature flag `projects` is off by default.

## ◆ Vimla

Dedicated operator destination (`/vimla`). No Auto/PRO model selector. Explicit `@Vimla` mention in ordinary AI chat also creates an operator run on that conversation. Feature flag `vimlaOperator` is off by default.

## Settings

- Аккаунт
- Безопасность
- Тариф и оплата
- Внешний вид
- Уведомления
