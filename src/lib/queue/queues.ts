import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

const connection = getRedisConnection();

export const QUEUE_NAMES = {
  CREATOR_DISCOVERY: "creator-discovery",
  FULFILLMENT: "fulfillment",
  SQS_CONSUMER: "sqs-consumer",
  TREND_INGESTION: "trend-ingestion",
  CONTENT_BRIEF: "content-brief",
  COMPLIANCE_CHECK: "compliance-check",
} as const;

export const creatorDiscoveryQueue = new Queue("creator-discovery", {
  connection,
});
export const fulfillmentQueue = new Queue("fulfillment", { connection });
export const sqsConsumerQueue = new Queue("sqs-consumer", { connection });
export const trendIngestionQueue = new Queue("trend-ingestion", { connection });
export const contentBriefQueue = new Queue("content-brief", { connection });
export const complianceCheckQueue = new Queue("compliance-check", {
  connection,
});

export const ALL_QUEUES = [
  creatorDiscoveryQueue,
  fulfillmentQueue,
  sqsConsumerQueue,
  trendIngestionQueue,
  contentBriefQueue,
  complianceCheckQueue,
];
