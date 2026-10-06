// Single source of truth for Web E2E domain ownership and measured CI weights.
// Every discovered *.spec.ts file under apps/web/e2e must belong to exactly one
// suite. New specs intentionally fail the CI contract until they are assigned.
export const DEFAULT_WEB_E2E_SECONDS = 30;

export const WEB_E2E_SUITES = [
  {
    id: "direct-chats-e2ee",
    label: "Direct Chats + E2EE",
    shards: 2,
    files: [
      "direct-chats.spec.ts",
      "direct-chats-cross-browser.spec.ts",
      "e2ee-h02-storage-regression.spec.ts",
      "e2ee-h02-security.spec.ts",
    ],
  },
  {
    id: "messaging-ai",
    label: "Messaging + AI",
    shards: 1,
    files: [
      "unified-inbox.spec.ts",
      "chat.spec.ts",
      "chat-design-system.spec.ts",
      "master-detail.spec.ts",
      "app-shell-navigation.spec.ts",
      "contextual-sidebar-navigation.spec.ts",
    ],
  },
  {
    id: "identity-account",
    label: "Identity + Account",
    shards: 1,
    files: [
      "registration.spec.ts",
      "password-reset.spec.ts",
      "sessions.spec.ts",
      "locale-errors.spec.ts",
      "public-profile.spec.ts",
      "billing.spec.ts",
      "auth-design-system.spec.ts",
    ],
  },
  {
    id: "work-projects",
    label: "Work + Projects",
    shards: 1,
    files: [
      "work-layout.spec.ts",
      "workspace.spec.ts",
      "projects.spec.ts",
      "projects-design-system.spec.ts",
      "workflow-ui.spec.ts",
      "operator.spec.ts",
      "notifications.spec.ts",
    ],
  },
  {
    id: "ui-release",
    label: "UI + Release Readiness",
    shards: 1,
    files: [
      "responsive-cross-browser.spec.ts",
      "responsive.spec.ts",
      "web-production-readiness.spec.ts",
      "settings-layout.spec.ts",
      "settings-design-system.spec.ts",
      "ui-v2.spec.ts",
      "ui-state-lab.spec.ts",
      "landing-design-system.spec.ts",
      "visual.spec.ts",
    ],
  },
];

// Seconds of Playwright execution observed on CI #2083. These values are only
// balancing hints; pass/fail never depends on them. Assigned but unmeasured
// specs use DEFAULT_WEB_E2E_SECONDS until fresh timings are recorded.
export const WEB_E2E_MEASURED_SECONDS = new Map([
  ["direct-chats.spec.ts", 101.5],
  ["direct-chats-cross-browser.spec.ts", 63.9],
  ["e2ee-h02-storage-regression.spec.ts", 53.0],
  ["unified-inbox.spec.ts", 52.8],
  ["work-layout.spec.ts", 36.0],
  ["responsive-cross-browser.spec.ts", 30.8],
  ["master-detail.spec.ts", 28.6],
  ["responsive.spec.ts", 27.1],
  ["notifications.spec.ts", 25.6],
  ["e2ee-h02-security.spec.ts", 24.8],
  ["workspace.spec.ts", 23.4],
  ["projects.spec.ts", 21.9],
  ["web-production-readiness.spec.ts", 19.3],
  ["chat.spec.ts", 18.5],
  ["settings-layout.spec.ts", 15.6],
  ["chat-design-system.spec.ts", 14.5],
  ["billing.spec.ts", 13.2],
  ["public-profile.spec.ts", 13.0],
  ["locale-errors.spec.ts", 12.5],
  ["password-reset.spec.ts", 12.1],
  ["projects-design-system.spec.ts", 12.1],
  ["workflow-ui.spec.ts", 12.0],
  ["auth-design-system.spec.ts", 11.4],
  ["ui-v2.spec.ts", 11.1],
  ["app-shell-navigation.spec.ts", 10.6],
  ["operator.spec.ts", 9.1],
  ["registration.spec.ts", 8.7],
  ["contextual-sidebar-navigation.spec.ts", 8.4],
  ["settings-design-system.spec.ts", 8.1],
  ["ui-state-lab.spec.ts", 6.1],
  ["sessions.spec.ts", 5.9],
  ["landing-design-system.spec.ts", 5.1],
  ["visual.spec.ts", 0.1],
]);
