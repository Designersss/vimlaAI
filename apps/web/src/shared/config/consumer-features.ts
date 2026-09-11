export const CONSUMER_FEATURES = {
  projects: false,
  // Off unless local/test explicitly set NEXT_PUBLIC_VIMLA_OPERATOR=true.
  vimlaOperator: process.env.NEXT_PUBLIC_VIMLA_OPERATOR === "true",
  directChats: false,
  autoRouter: false,
  notificationsSettings: true,
} as const;

export type ConsumerFeature = keyof typeof CONSUMER_FEATURES;
