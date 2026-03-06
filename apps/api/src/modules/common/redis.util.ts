import type { ConnectionOptions } from 'bullmq';

export function getRedisConnection(redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380'): ConnectionOptions {
  const url = new URL(redisUrl);
  const port = Number(url.port || '6379');
  const dbFromPath = url.pathname ? Number(url.pathname.replace('/', '')) : 0;

  return {
    host: url.hostname,
    port: Number.isNaN(port) ? 6379 : port,
    password: url.password || undefined,
    db: Number.isNaN(dbFromPath) ? 0 : dbFromPath,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
