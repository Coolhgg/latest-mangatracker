import { Worker } from 'bullmq';
import { redis, disconnectRedis } from '@/lib/redis';
import { CHECK_SOURCE_QUEUE, NOTIFICATION_QUEUE } from '@/lib/queues';
import { processCheckSource } from './processors/check-source.processor';
import { processNotification } from './processors/notification.processor';
import { runMasterScheduler } from './schedulers/master.scheduler';

console.log('[Workers] Starting...');

// Check Source Worker
const checkSourceWorker = new Worker(
  CHECK_SOURCE_QUEUE,
  processCheckSource,
  { 
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

// Notification Worker
const notificationWorker = new Worker(
  NOTIFICATION_QUEUE,
  processNotification,
  { 
    connection: redis,
    concurrency: 10,
  }
);

// Scheduler interval
const SCHEDULER_INTERVAL = 5 * 60 * 1000; // 5 minutes
let schedulerInterval: NodeJS.Timeout | null = null;

async function startScheduler() {
  // Run immediately on start
  try {
    await runMasterScheduler();
  } catch (error) {
    console.error('[Scheduler] Initial run failed:', error);
  }
  
  schedulerInterval = setInterval(async () => {
    try {
      await runMasterScheduler();
    } catch (error) {
      console.error('[Scheduler] Error in master scheduler:', error);
    }
  }, SCHEDULER_INTERVAL);
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Workers] Received ${signal}, shutting down gracefully...`);
  
  // Stop scheduler
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  // Close workers (waits for current jobs to finish)
  await Promise.all([
    checkSourceWorker.close(),
    notificationWorker.close(),
  ]);

  // Disconnect Redis
  await disconnectRedis();
  
  console.log('[Workers] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Worker event handlers
checkSourceWorker.on('completed', (job) => {
  console.log(`[CheckSource] Job ${job.id} completed`);
});

checkSourceWorker.on('failed', (job, err) => {
  console.error(`[CheckSource] Job ${job?.id} failed:`, err.message);
});

notificationWorker.on('completed', (job) => {
  console.log(`[Notification] Job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
  console.error(`[Notification] Job ${job?.id} failed:`, err.message);
});

startScheduler().catch(console.error);

console.log('[Workers] Active and listening for jobs');
