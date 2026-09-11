# Vimla Navigation IA v2

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
