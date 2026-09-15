# Persistent consumer feature layouts

Issue #15 introduced the persistent consumer shell and responsive chat master/detail architecture. Issue #17 extends the same route-layout principles to Projects, Settings and Work where the product has real collection/detail or stable local-navigation semantics. Public feature URLs remain deterministic and feature gates remain authoritative.

## Route and component ownership

```text
RootLayout (locale, appearance, toasts)
  (consumer)/layout -> ConsumerShell -> AppShell (navigation, account, notifications)
    app/layout -> ChatWorkspaceProvider -> ChatRouteShell -> MasterDetailLayout
      ConversationListPane (persistent)
      children (detail slot)
        app/page -> no-selection state
        app/[conversationId]/page -> ConversationWorkspace
        app/direct/[id]/page -> DirectChatWorkspace (feature-gated)
        app/loading, error, not-found -> detail status and deterministic Back

    projects/layout -> ProjectsRouteShell -> ProjectsWorkspaceProvider -> MasterDetailLayout
      ProjectListPane (persistent for normal project routes)
      children (detail slot)
        projects/page -> no-selection state
        projects/[id]/page -> ProjectOverview
        projects/[id]/members/page -> ProjectMembers
      projects/join -> focused join flow without the project master pane

    settings/layout -> SettingsRouteShell -> MasterDetailLayout
      SettingsNavigationPane (persistent)
      children (detail slot)
        settings/page -> settings menu/master route; neutral desktop detail
        settings/account -> AccountSettings
        settings/security -> SecuritySettings
        settings/billing -> BillingSettings
        settings/appearance -> AppearanceSettings
        settings/notifications -> NotificationSettings (feature-gated)
        settings/loading, error -> scoped detail status/recovery

    work/layout -> WorkShell -> ConsumerPage (persistent Work navigation)
      work/page -> WorkToday (single-pane)
      work/tasks/page -> WorkTasks (single-pane)
      work/reminders/page -> WorkReminders (single-pane)
      work/notes/layout -> WorkNotesRouteShell -> MasterDetailLayout
        WorkNotes (persistent collection pane)
        work/notes/page -> no-selection state
        work/notes/[id]/page -> WorkNoteEditor
        work/notes/[id]/loading,error -> scoped detail recovery
      work/lists/layout -> WorkListsRouteShell -> MasterDetailLayout
        WorkLists (persistent collection pane)
        work/lists/page -> no-selection state
        work/lists/[id]/page -> WorkListDetail
        work/lists/[id]/loading,error -> scoped detail recovery
      work/loading,error -> scoped below persistent Work navigation

    vimla/* -> OperatorWorkspace -> ConsumerPage
```

`(consumer)` is a route group under the existing root layout, so it adds no URL segment or extra root document. `ConsumerPage` remains available for page-local composition where a feature does not need a persistent route shell. The global shell and notification inbox remain mounted across consumer destinations. Authentication and verified-email redirects remain client integrations; the API still authorizes every protected operation. A server-side initial session check is a separate future auth task.

## Selection, state and failure boundaries

### Chat

`ChatRouteShell` reads Next's selected layout segments. `/app` has no selection; `/app/[conversationId]` selects an AI detail; `/app/direct/[id]` selects a direct detail. The store never owns navigation or an active route. Rows use injected Next `Link` rendering with `scroll={false}` and normal framework prefetching. No browser location assignment, artificial transitions or viewport-dependent feature tree is used.

The provider owns one `ChatWorkspaceStore` while the user stays under `/app`. It retains summaries and a `ConversationState` per visited AI conversation (draft, optimistic messages, stream, error and operator busy state). List search/filter state and its scroll container remain mounted. Changing the detail ID keys only the detail component; an in-flight callback retains the original conversation state. Detail requests revalidate server data on entry, and a revision guard prevents older fetches overwriting a newer send. A new provider after leaving `/app`, signing out or reloading has fresh memory. No auth/session or plaintext draft persistence is added.

Lists and details load independently. Expected API failures render localized states and retries inside the affected pane. Next loading/error/not-found boundaries wrap the detail children inside the chat layout. Back is available even on a failed or loading mobile detail and always points to `/app`. The shared header focuses its title after mounting without scrolling the persistent list.

Direct Chat encryption, IndexedDB, devices, consent and session adapters remain in their existing web feature. The provider coordinates simultaneous list/detail calls to the existing browser device initializer so a cold deep link does not register competing devices. This is local mount coordination, not a new cross-tab crypto or durable idempotency guarantee. Direct read responses update list unread metadata from the server. Production Direct Chat, Projects and Operator gates remain OFF by default.

### Projects

`ProjectsRouteShell` also reads selected layout segments. `/projects` has no selected project; `/projects/[id]` and its real nested subsections select that project. `/projects/join` is deliberately treated as a focused single-purpose flow rather than being forced into master/detail composition.

`ProjectsWorkspaceProvider` is scoped to normal `/projects` routes and owns only non-authoritative client list state: project summaries, loading/error state and list synchronization after create/update/delete/leave actions. The API/database remain authoritative for ownership, membership, capabilities, plan locks and entitlements. `ProjectOverview` updates the in-memory summary only after the authoritative mutation succeeds. Deleting or leaving removes that project from the local list only after the server confirms the action.

The selected project is never stored as navigation truth in the provider. The URL determines selection. Project rows use injected Next `Link` rendering with `scroll={false}` so changing project details does not reload the document or replace the surrounding list. Project-local navigation (Overview / Chats / Work / Context / Members) remains inside the detail pane and is not promoted into global navigation.

On narrow layouts a deterministic Back control points to `/projects`; it does not depend on browser history, so direct deep links remain recoverable. On desktop the same control is hidden and the persistent project list remains visible beside the detail.

### Settings

Settings are stable local navigation rather than an entity collection. `SettingsRouteShell` reads the selected route segment and passes that selection into the presentation-only `MasterDetailLayout`; no React store owns the selected section.

`/settings` is now the deterministic master/menu route. On narrow layouts it shows the settings navigation only. `/settings/account`, `/settings/security`, `/settings/billing`, `/settings/appearance` and `/settings/notifications` show the selected detail with an explicit Back link to `/settings`. This makes direct deep links recoverable without depending on browser history and avoids viewport-dependent redirects.

At the shared wide breakpoint the same `SettingsNavigationPane` remains mounted beside the selected section. Switching sections uses normal Next links, so the navigation DOM is preserved while only the route detail changes. Account, appearance, billing, notification and security components keep their existing data flows; no billing, session, passkey, notification or account authority is copied into presentation state.

Settings `loading.tsx` and `error.tsx` live below the persistent settings layout, so asynchronous route status and recovery do not remove global navigation or the settings menu. The error boundary uses the App Router `reset` contract.

### Work

Work is intentionally mixed rather than forced into one universal master/detail structure. The `/work` route layout now owns `WorkShell`, so the feature-local Today / Tasks / Reminders / Lists / Notes navigation remains mounted while child routes change. The URL remains authoritative for the active Work subsection.

Tasks and Reminders stay single-pane because the current domain has no route-addressable `/tasks/[id]` or `/reminders/[id]` detail screens. No fake detail routes or duplicate mobile implementations are introduced for architectural symmetry.

Notes and Lists already have genuine collection/detail routes, so each collection gets a nested route shell using the same presentation-only `MasterDetailLayout`. `/work/notes` and `/work/lists` are the deterministic collection routes; `/work/notes/[id]` and `/work/lists/[id]` select details from the URL. At wide widths the collection pane stays mounted beside the detail. At narrow widths the same components behave as list -> detail screens, with an explicit Back link to the corresponding collection route. Direct detail deep links and refreshes therefore remain recoverable without depending on browser history.

`WorkspaceViewSyncProvider` is scoped to the persistent Work layout and owns only revision counters used to refresh the visible Notes/Lists collections after successful authoritative create/update/delete operations. It does not store selected IDs, permissions, identity or persisted Workspace objects as authority. All Workspace persistence and ownership checks continue through the existing authenticated API and `@vimla/workspace` domain services.

Detail route `loading.tsx` and `error.tsx` boundaries live inside the nested Notes/Lists layouts, so a loading or failed note/list detail does not remove the persistent collection on desktop or the outer Work navigation. Error boundaries use the App Router `error` + `reset` contract. The outer Work loading/error boundaries are likewise below `WorkShell`, preserving the feature navigation.

## Responsive composition

`@vimla/ui` exports a presentation-only `MasterDetailLayout`: master/detail content, labels and `detailOpen`. It imports no router or domain code. At the shared `lg` breakpoint (1024px) both panels appear; below it CSS hides the inactive panel, including its focusable elements. The 768px tablet still has the narrower global sidebar, so it uses one feature pane to avoid two unusably narrow columns. There is one master and one detail implementation across widths.

Chat, Projects, Settings and Work opt into the application viewport mode so their persistent navigation/list/detail regions can scroll independently without document-level navigation jumps. Mobile still reserves safe-area-aware space for the global bottom navigation. Very short screens remain scrollable. Other consumers of `AppShell` retain document scrolling until their own route architecture explicitly requires a persistent viewport.

Project detail keeps the canonical project-local navigation inside the detail content. The master project list is a drill-down collection pane, not a second global navigation layer. `/projects/join` bypasses the project master pane. Settings navigation is likewise feature-local and visually subordinate to the one global Vimla navigation layer. Work keeps one persistent feature-local navigation row; only Notes and Lists add nested collection/detail composition because those routes have real entity-detail semantics.

## Platform boundaries

- **Shared today:** `@vimla/contracts` request/response types, validation, domain packages and `@vimla/e2ee` crypto. Client state is non-authoritative and does not decide permissions, billing or entitlements.
- **Web adapters:** route files and feature route shells select IDs/sections; feature components bind services/actions; API services encapsulate cookie transport/config. Navigation remains a platform concern rather than domain/store state.
- **Web presentation:** `@vimla/ui` remains DOM/SCSS. `MasterDetailLayout` is presentation-only and chat/project/settings/work agnostic. Tokens remain semantic; no universal DOM/native compatibility layer is introduced.
- **Future only:** Next.js web, Tauri + React desktop, React Native + Expo mobile. Native navigators can supply selected IDs/sections to equivalent feature/domain APIs and implement native master-detail navigation and platform capability adapters. No native apps, packages, dependencies or speculative adapter framework are created here.

## Verification

`master-detail.spec.ts` covers persistent Chat DOM identity, client navigation, list search/filter/scroll, per-chat drafts, refresh/deep links, mobile Back and browser history, pending/failed detail recovery, consumer destinations and the representative width/height matrix.

`projects.spec.ts` covers project creation through the persistent master pane, selected-row routing, persistent master DOM identity across overview/members navigation, mobile list/detail switching, deterministic Back, deep-link refresh and the representative viewport matrix.

`settings-layout.spec.ts` covers persistent Settings navigation DOM identity while switching sections, the deterministic mobile `/settings` menu/detail model, direct deep-link refresh and the representative viewport matrix.

`work-layout.spec.ts` covers persistent Work navigation identity across Today/Tasks/Reminders/Notes/Lists, verifies Tasks/Reminders remain single-pane, exercises persistent Notes and Lists collection/detail behavior on desktop, deterministic Back and deep-link refresh on mobile, collection synchronization after note edits, and the representative nested-layout viewport matrix. `workspace.spec.ts` remains the domain-flow regression suite for Tasks, Reminders, Lists, Notes and Today.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e` and `git diff --check` using local/test databases and mock providers. No formatter command is configured.

Physical iOS Safari and Android Chrome virtual keyboards cannot be fully simulated by Playwright. Before a production UI rollout, verify critical project, settings, chat and Work interactions on representative physical devices, including portrait/landscape, safe areas and short viewport heights.
