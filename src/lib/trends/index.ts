export { ApifyTrendClient } from "./apify-client";
export type { ApifyClientOptions } from "./apify-client";

export { TrendIngestionPipeline } from "./ingestion";
export type { IngestionResult } from "./ingestion";

export { SuperViralDetector } from "./alerts";

export type {
  TrendingHashtag,
  TrendingSound,
  ViralVideo,
  CreatorStat,
  TrendStreamType,
  TrendIngestionConfig,
  StoredTrend,
  SuperViralAlert,
  AlertConfig,
  SuperViralThresholds,
  ApifyActorConfig,
} from "./types";

export { DEFAULT_SUPER_VIRAL_THRESHOLDS } from "./types";
