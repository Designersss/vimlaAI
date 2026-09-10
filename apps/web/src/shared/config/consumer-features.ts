export const CONSUMER_FEATURES = {
  projects: false,
  vimlaOperator: false,
  directChats: false,
  autoRouter: false,
  notificationsSettings: true,
} as const;

export type ConsumerFeature = keyof typeof CONSUMER_FEATURES;
