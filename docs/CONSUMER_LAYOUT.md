# Persistent consumer and chat layouts

Issue #15 and its cross-platform architecture comment supersede the earlier Messages-only drill-down composition. Public URLs and feature gates are unchanged.

## Route and component ownership

Before:

```text
RootLayout
  /app page -> MessagesCollection -> ConsumerShell -> AppShell
  /app/[conversationId] page -> ConversationWorkspace -> ConsumerShell -> AppShell
  /app/direct/[id] page -> DirectChatWorkspace -> ConsumerShell -> AppShell
  other consumer pages -> feature chrome -> ConsumerShell -> AppShell
```

After:

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
    projects/* -> ProjectShell -> ConsumerPage
    work/* -> WorkShell -> ConsumerPage
    settings/* -> SettingsChrome -> ConsumerPage
    vimla/* -> OperatorWorkspace -> ConsumerPage
```

`(consumer)` is a route group under the existing root layout, so it adds no URL segment or extra root document. `ConsumerPage` provides only local navigation and spacing. The global shell and notification inbox remain mounted across consumer destinations. Authentication and verified-email redirects remain client integrations; the API still authorizes every protected operation. A server-side initial session check is a separate future auth task.

## Selection, state and failure boundaries

`ChatRouteShell` reads Next's selected layout segments. `/app` has no selection; `/app/[conversationId]` selects an AI detail; `/app/direct/[id]` selects a direct detail. The store never owns navigation or an active route. Rows use injected Next `Link` rendering with `scroll={false}` and normal framework prefetching. No browser location assignment, artificial transitions or viewport-dependent feature tree is used.

The provider owns one `ChatWorkspaceStore` while the user stays under `/app`. It retains summaries and a `ConversationState` per visited AI conversation (draft, optimistic messages, stream, error and operator busy state). List search/filter state and its scroll container remain mounted. Changing the detail ID keys only the detail component; an in-flight callback retains the original conversation state. Detail requests revalidate server data on entry, and a revision guard prevents older fetches overwriting a newer send. A new provider after leaving `/app`, signing out or reloading has fresh memory. No auth/session or plaintext draft persistence is added.

Lists and details load independently. Expected API failures render localized states and retries inside the affected pane. Next loading/error/not-found boundaries wrap the detail children inside the chat layout. Back is available even on a failed or loading mobile detail and always points to `/app`. The shared header focuses its title after mounting without scrolling the persistent list.

Direct Chat encryption, IndexedDB, devices, consent and session adapters remain in their existing web feature. The provider coordinates simultaneous list/detail calls to the existing browser device initializer so a cold deep link does not register competing devices. This is local mount coordination, not a new cross-tab crypto or durable idempotency guarantee. Direct read responses update list unread metadata from the server. Production Direct Chat, Projects and Operator gates remain OFF by default.

## Responsive composition

`@vimla/ui` exports a presentation-only `MasterDetailLayout`: master/detail content, labels and `detailOpen`. It imports no router or domain code. At the shared `lg` breakpoint (1024px) both panels appear; below it CSS hides the inactive panel, including its focusable elements. The 768px tablet still has the narrower global sidebar, so it uses one chat pane to avoid two unusably narrow columns. There is one list and one detail implementation across widths.

The chat shell opts into dynamic viewport height, with independent list/thread scrolling, a reachable composer, safe-area padding and the existing mobile global navigation. Very short screens can scroll the detail panel as a whole if its header/composer cannot fit. Other consumers of `AppShell` retain document scrolling. Semantic tokens and centralized breakpoints govern the layout; themes and reduced motion use the existing system.

## Platform boundaries

- **Shared today:** `@vimla/contracts` request/response types, validation, domain packages and `@vimla/e2ee` crypto. Chat stores import only MobX and contract types; no Next, DOM, cookies, storage or media queries.
- **Web adapters:** route files and `ChatRouteShell` select IDs; feature components bind services/actions; `ChatWorkspaceProvider` owns browser-device integration; existing API services inject `fetch` where supported and encapsulate cookie transport/config. Future shared API-client extraction can replace these edges without adding routes to store APIs.
- **Web presentation:** `@vimla/ui` remains DOM/SCSS. Tokens remain semantic; no universal DOM/native compatibility layer is introduced.
- **Future only:** Next.js web, Tauri + React desktop, React Native + Expo mobile. Native navigators can supply IDs to the same state/domain APIs and implement native master-detail navigation and platform capability adapters. No native apps, packages, dependencies or speculative adapter framework are created here.

## Verification

`master-detail.spec.ts` covers persistent DOM identity, client navigation, list search/filter/scroll, per-chat drafts, refresh/deep links, mobile Back and browser history, pending/failed detail recovery, consumer destinations and the representative width/height matrix. Existing Direct Chat tests exercise real test devices and encrypted exchange. Focused cross-browser smoke exercises the same chat navigation on Chromium, mobile WebKit and Firefox. Unit tests cover interleaved streams, stale reads, draft isolation and fresh provider state.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e` and `git diff --check` using local/test databases and mock providers. Playwright attaches desktop detail/mobile list/mobile detail screenshots. No formatter command is configured.

Physical iOS Safari and Android Chrome virtual keyboards cannot be fully simulated by Playwright: before a production UI rollout, open a long chat on each device, focus the composer, show/dismiss the keyboard, rotate the device and verify Send, Back and global navigation remain reachable without horizontal overflow.
