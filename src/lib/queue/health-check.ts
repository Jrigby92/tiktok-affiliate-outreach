import Redis from "ioredis";
import { ALL_QUEUES } from "./queues";

export async function checkQueueHealth(): Promise<{
  redis: boolean;
  queues: Record<string, boolean>;
}> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(redisUrl);
  let redisOk = false;
  try {
    const pong = await redis.ping();
    redisOk = pong === "PONG";
  } catch {
    redisOk = false;
  } finally {
    await redis.quit();
  }

  const queues: Record<string, boolean> = {};
  for (const q of ALL_QUEUES) {
    try {
      await q.getJobCounts();
      queues[q.name] = true;
    } catch {
      queues[q.name] = false;
    }
  }
  return { redis: redisOk, queues };
}
