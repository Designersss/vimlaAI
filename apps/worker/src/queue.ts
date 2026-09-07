export const MAINTENANCE_QUEUE_NAME = "vimla-maintenance";

export function redisConnectionOptions(redisUrl: string): {
  url: string;
  maxRetriesPerRequest: null;
} {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}
