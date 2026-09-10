# Vimla Page Patterns v2

## Global invariant

Desktop/tablet: exactly ONE global navigation layer.

List and detail are separate pages. No ChatGPT-style permanent conversation history next to conversation detail.

## Collection Page

Used for Messages, Projects, Notes, Lists.

`GlobalSidebar + Main(PageHeader, Search, local tabs/filters, optional Pinned/Folders, list/grid)`

## Work List Page

Used by My Work/Today/Tasks/Reminders.

Canonical local My Work navigation:
- Сегодня
- Задачи
- Напоминания
- Списки
- Заметки

`Завтра`, `На этой неделе`, `Завершено` are local filters/grouping, never top-level My Work tabs.

A supplementary panel is allowed only as non-navigation content on wide desktop and must reflow below on smaller screens.

## Conversation Detail

`GlobalSidebar + ConversationHeader + MessageThread + Composer`.

Separate route/screen after selecting a conversation.

## Object Detail

`GlobalSidebar + Back + ObjectHeader + content/editor`. No second sidebar.

## Project Workspace

Canonical local navigation:
- Обзор
- Чаты
- Работа
- Контекст
- Участники

Local project navigation lives inside main content.

## Settings

Settings categories are local page navigation. They may form a compact in-content column on wide desktop, but are visually subordinate and not a second global app sidebar.
