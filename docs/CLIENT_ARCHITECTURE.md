# Vimla Client Architecture

Status: **canonical multi-client client architecture**  
Parent architecture: `docs/MESSENGER_PLATFORM_ARCHITECTURE.md`  
Roadmap: GitHub #78, #79, #88, #89.

## 1. Objective

Build Web first while ensuring future Desktop/Mobile reuse the same backend contracts and as much real client/domain logic as is safe.

Reuse is achieved by separating **logic from renderer/platform**, not by forcing one UI technology onto every device.

## 2. Target layers

```text
@vimla/contracts / shared browser-safe foundations
                    │
                    ▼
           platform-neutral client API
                    │
                    ▼
            client/domain core state
                    │
             ┌──────┼──────┐
             │      │      │
          Sync    Context  E2EE protocol core
             │      │      │
             └──────┼──────┘
                    │
             platform adapters
          ┌─────────┼─────────┐
          │         │         │
         Web     Desktop    Mobile
          │         │         │
       DOM UI    DOM UI    Native UI
```

Package names such as `@vimla/client-api` or `@vimla/client-core` are allowed only when extraction has a concrete reuse/testability purpose.

## 3. Core must not import platform runtime

Platform-neutral client code must not directly depend on:

- Next.js router/App Router;
- `window`/`document`;
- IndexedDB/localStorage;
- Tauri APIs;
- Expo/React Native APIs;
- Prisma/NestJS;
- server config/secrets/provider SDKs.

Use small injected ports/capabilities where required.

## 4. Suggested ports

Prefer focused interfaces:

- HttpTransport / session transport;
- RealtimeTransport;
- LocalStateStore;
- SecureStore;
- MediaCache;
- DeepLink/Navigation adapter;
- Push/Notification adapter;
- File/Media picker;
- Clipboard;
- AppLifecycle.

Do not create one giant `PlatformService`.

## 5. Web

Current host:

- Next.js 16;
- React 19;
- MobX client/UI state;
- SCSS Modules;
- `@vimla/ui`.

Next route files/layouts remain Web adapters.

Business/product operations should call reusable typed clients/services rather than implement domain behavior in route components.

Browser cookie auth keeps Origin/CSRF protections.

## 6. Desktop

Created only after Design Freeze.

Expected host: Tauri + React/Vite unless a later reviewed issue changes the choice.

Reuse targets:

- contracts;
- API client/core;
- SyncEngine/context;
- E2EE protocol core;
- finalized DOM product components;
- design tokens/i18n.

Desktop-specific:

- OS secure storage;
- filesystem;
- local DB;
- media cache;
- notifications;
- deep links;
- tray/window/updater lifecycle.

Tauri/Rust is a platform bridge, not a second Vimla backend.

## 7. Mobile

Created after Desktop parity.

Expected host: React Native + Expo unless a later reviewed issue changes the choice.

Reuse targets:

- contracts;
- API client/core;
- SyncEngine/context;
- E2EE protocol core;
- design tokens/i18n/domain formatting.

Mobile-specific:

- native presentation/navigation;
- secure storage;
- local DB;
- filesystem cache;
- APNs/FCM;
- camera/media/file picker;
- background/resume lifecycle.

Do not wrap the entire Web app in a WebView solely to maximize percentage reuse.

## 8. Authentication

Authentication transport may differ by platform; authorization does not.

All domain services receive a server-authenticated actor.

Browser:
- HttpOnly cookie/session;
- trusted Origin / CSRF-safe mutation semantics.

Native:
- reviewed native session transport;
- secure local session material.

Never treat `X-Platform: mobile`, installation kind or app version as permission authority.

## 9. ClientInstallation vs crypto device

`ClientInstallation` represents an app installation for sync/push/preferences/telemetry.

`UserCryptoDevice` represents cryptographic identity/protocol state.

They may be linked but are not identical concepts.

Revoking one must follow explicit lifecycle rules rather than accidental cascade assumptions.

## 10. Settings scopes

- ACCOUNT: roaming user preferences.
- INSTALLATION: cache/autodownload/local notification behavior etc.
- SURFACE: mute/pin/archive/surface notification/AI privacy.

Only security/product requirements determine which setting belongs to which scope.

## 11. Navigation

Reusable code uses semantic `NavigationTarget`.

Web maps target → Next route.
Desktop maps target → desktop router/deep link.
Mobile maps target → native navigator/deep link.

No domain/backend Web `hrefPath`.

## 12. API version skew

Web may update with the backend immediately; native apps may lag.

Before native release:

- prefer additive compatible contract evolution;
- define deprecation windows;
- never assume all clients update with one deploy;
- use explicit protocol/capability bootstrap where useful;
- use versioned breaking APIs only with reviewed migration.

## 13. Presentation/design

The owner manually finalizes Web design before Desktop.

Design tokens must be semantic and portable.

Web/Desktop may reuse the same product DOM components after Design Freeze.

Mobile may reimplement presentation natively while sharing state/controllers/contracts/tokens.

## 14. User-facing maintenance

Sync repairs automatically.

Users do not receive “Resync local DB”, “Reset ratchet” or “Clear Direct Chat data” maintenance controls.

Desktop/Mobile expose a simple **Clear cache** action for reproducible media cache only.
