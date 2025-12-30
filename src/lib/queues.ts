import { Queue } from 'bullmq';
import { redis } from './redis';

export const CHECK_SOURCE_QUEUE = 'check-source';
export const NOTIFICATION_QUEUE = 'notifications';

export const checkSourceQueue = new Queue(CHECK_SOURCE_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const notificationQueue = new Queue(NOTIFICATION_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});
