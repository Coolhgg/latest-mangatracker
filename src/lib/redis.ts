import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const REDIS_KEY_PREFIX = 'kenmei:';

/**
 * Shared Redis instance for the application.
 * Configured with a key prefix for namespacing and robust retry strategy.
 */
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
  keyPrefix: REDIS_KEY_PREFIX,
  enableReadyCheck: true,
  lazyConnect: true, // Only connect when needed
  retryStrategy: (times) => {
    // Exponential backoff with a cap
    const delay = Math.min(times * 200, 5000);
    if (times > 20) {
      console.error(`[Redis] Failed to connect after ${times} attempts. Giving up.`);
      return null;
    }
    return delay;
  },
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some(e => err.message.includes(e));
  },
});

redis.on('error', (err) => {
  // Silent standard errors, but log critical ones
  if (!err.message.includes('ECONNREFUSED')) {
    console.error('[Redis] Error:', err.message);
  }
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

/**
 * Safely disconnects from Redis, ensuring all pending commands are processed.
 */
export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'end') return;
  
  try {
    await redis.quit();
    console.log('[Redis] Disconnected');
  } catch (err) {
    console.error('[Redis] Error during disconnect:', err);
    redis.disconnect(); // Force disconnect if quit fails
  }
}
