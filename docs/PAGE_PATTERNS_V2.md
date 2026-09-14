# Vimla Page Patterns v2

## Global invariant

Desktop/tablet: exactly ONE global navigation layer.

List and detail retain separate URLs. Issue #15 adds a persistent local Messages list beside detail at ≥1024px, with one selected pane below that width. Issue #17 applies the same drill-down pattern to Projects and the same persistent-route principle to Settings. These feature-local panes are not global navigation. See `docs/CONSUMER_LAYOUT.md`.

## Collection Page

Used for Messages, Projects, Notes, Lists.

`GlobalSidebar + Main(PageHeader, Search, local tabs/filters, optional Pinned/Folders, list/grid)`

Where a collection has real route-addressable details and the feature task explicitly opts in, the collection may remain mounted as a local master pane on wide layouts and collapse to route-selected single panes below the shared usable-width breakpoint.

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

`GlobalSidebar + MasterDetailLayout(ConversationListPane, ConversationHeader + MessageThread + Composer)`.

Separate route/screen after selecting a conversation.

## Object Detail

`GlobalSidebar + Back + ObjectHeader + content/editor` by default. A feature may keep its real collection master mounted on wide layouts only when the approved route architecture explicitly uses master/detail; do not invent a second global sidebar.

## Project Workspace

Canonical local navigation:
- Обзор
- Чаты
- Работа
- Контекст
- Участники

Normal project routes use:

`GlobalSidebar + MasterDetailLayout(ProjectListPane, Project detail)` at ≥1024px.

Below that breakpoint `/projects` is the project collection and `/projects/[id]...` is the route-selected project detail. Project-local navigation stays inside the detail content. The project collection is a drill-down pane, not global navigation. Focused flows such as `/projects/join` do not have to render the master pane.

## Settings

Settings categories are persistent feature-local navigation, not an entity collection and not a second global app sidebar.

At ≥1024px:

`GlobalSidebar + MasterDetailLayout(SettingsNavigationPane, Selected settings section)`

The navigation pane stays mounted while moving among Account, Security, Billing, Appearance and Notifications.

Below 1024px:

- `/settings` is the settings menu/master screen;
- `/settings/<section>` is the selected section detail;
- detail uses a deterministic Back link to `/settings`;
- the same navigation and section components are used at every width.

Selection remains URL-driven. Do not introduce a client store for the active settings section, and do not move billing/security/session authority into presentation state.
