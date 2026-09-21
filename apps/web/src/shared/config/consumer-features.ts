export const CONSUMER_FEATURES = {
  projects: process.env.NEXT_PUBLIC_VIMLA_PROJECTS === "true",
  // Off unless local/test explicitly set NEXT_PUBLIC_VIMLA_OPERATOR=true.
  vimlaOperator: process.env.NEXT_PUBLIC_VIMLA_OPERATOR === "true",
  directChats: process.env.NEXT_PUBLIC_VIMLA_DIRECT_CHATS === "true",
  orchestrationUi: process.env.NEXT_PUBLIC_VIMLA_ORCHESTRATION_UI === "true",
  autoRouter: false,
  notificationsSettings: true,
} as const;

export type ConsumerFeature = keyof typeof CONSUMER_FEATURES;
