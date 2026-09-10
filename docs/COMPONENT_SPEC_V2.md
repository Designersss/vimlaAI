# Vimla Component Spec v2

`@vimla/ui` remains the single canonical source of reusable UI.

## Global navigation

Desktop/tablet top-level destinations:
- Сообщения
- Мои дела
- Проекты
- ◆ Vimla
- Настройки

Global navigation contains NO folders, chat history, notes/tasks/reminders, project list, favorites or archive.

Mobile bottom navigation has exactly:
- Сообщения
- Дела
- Проекты
- Vimla

Profile/Settings via avatar/contextual account UI.

## Core primitives

Button, IconButton, Input, PasswordInput, SearchInput, Textarea, Select, FormField, Checkbox, Radio, Switch, SegmentedControl, Tabs, Badge, Avatar, AvatarGroup, Dialog, Sheet/Drawer, Menu/Dropdown, Toast, Alert, Skeleton, EmptyState, ErrorState, Table where appropriate.

Every interactive primitive defines default/hover/focus-visible/pressed/disabled and loading/error/selected where applicable.

## Rows

Canonical BaseListRow: `leading | main text block | trailing metadata/actions`.

Reusable variants:
- AI ConversationRow
- Direct ConversationRow
- FolderRow
- TaskRow
- ReminderRow
- ProjectRow
- NoteRow
- ListRow

## Composer

AI Composer:
- multiline input;
- attachment/tools;
- dedicated `◆ @Vimla`;
- compact model selector;
- send.

Model selection is NEVER in the page header.

Root selector:
- Auto >
- PRO

Auto submenu:
- Минимум
- Среднее
- Максимум

PRO opens a separate model picker dialog with search + capability filters. Concrete models do not appear in the root menu.

Direct/Project human Composer:
- attachment;
- `◆ @Vimla`;
- text;
- send;
- no Auto/PRO by default.

Dedicated Vimla operator page:
- no model selector at all.
