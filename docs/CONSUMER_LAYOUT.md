# Persistent consumer feature layouts

Issue #15 introduced the persistent consumer shell and responsive chat master/detail architecture. Issue #17 extends the same route-layout principles to Projects where the product has real collection/detail semantics. Public URLs and feature gates are unchanged.

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

    work/* -> WorkShell -> ConsumerPage
    settings/* -> SettingsChrome -> ConsumerPage
    vimla/* -> OperatorWorkspace -> ConsumerPage
```

`(consumer)` is a route group under the existing root layout, so it adds no URL segment or extra root document. `ConsumerPage` provides only local navigation and spacing. The global shell and notification inbox remain mounted across consumer destinations. Authentication and verified-email redirects remain client integrations; the API still authorizes every protected operation. A server-side initial session check is a separate future auth task.

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

## Responsive composition

`@vimla/ui` exports a presentation-only `MasterDetailLayout`: master/detail content, labels and `detailOpen`. It imports no router or domain code. At the shared `lg` breakpoint (1024px) both panels appear; below it CSS hides the inactive panel, including its focusable elements. The 768px tablet still has the narrower global sidebar, so it uses one feature pane to avoid two unusably narrow columns. There is one list and one detail implementation across widths.

Both Chat and Projects opt into the application viewport mode so their persistent list/detail regions can scroll independently without document-level navigation jumps. Mobile still reserves safe-area-aware space for the global bottom navigation. Very short screens remain scrollable. Other consumers of `AppShell` retain document scrolling until their own route architecture explicitly requires a persistent viewport.

Project detail keeps the canonical project-local navigation inside the detail content. The master project list is a drill-down collection pane, not a second global navigation layer. `/projects/join` bypasses the project master pane.

## Platform boundaries

- **Shared today:** `@vimla/contracts` request/response types, validation, domain packages and `@vimla/e2ee` crypto. Client state is non-authoritative and does not decide permissions, billing or entitlements.
- **Web adapters:** route files and feature route shells select IDs; feature components bind services/actions; API services encapsulate cookie transport/config. Navigation remains a platform concern rather than domain/store state.
- **Web presentation:** `@vimla/ui` remains DOM/SCSS. `MasterDetailLayout` is presentation-only and project/chat agnostic. Tokens remain semantic; no universal DOM/native compatibility layer is introduced.
- **Future only:** Next.js web, Tauri + React desktop, React Native + Expo mobile. Native navigators can supply selected IDs to equivalent feature/domain APIs and implement native master-detail navigation and platform capability adapters. No native apps, packages, dependencies or speculative adapter framework are created here.

## Verification

`master-detail.spec.ts` covers persistent Chat DOM identity, client navigation, list search/filter/scroll, per-chat drafts, refresh/deep links, mobile Back and browser history, pending/failed detail recovery, consumer destinations and the representative width/height matrix.

`projects.spec.ts` covers project creation through the persistent master pane, selected-row routing, persistent master DOM identity across overview/members navigation, mobile list/detail switching, deterministic Back, deep-link refresh and the representative viewport matrix.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e` and `git diff --check` using local/test databases and mock providers. No formatter command is configured.

Physical iOS Safari and Android Chrome virtual keyboards cannot be fully simulated by Playwright. Before a production UI rollout, verify critical project and chat interactions on representative physical devices, including portrait/landscape, safe areas and short viewport heights.
