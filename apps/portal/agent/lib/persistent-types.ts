export type MemoryKind = "fact" | "preference" | "decision" | "lesson";

export type PersistentMemory = {
  id: string;
  ownerId: string;
  key: string;
  kind: MemoryKind;
  value: string;
  provenance: string;
  status: "active" | "forgotten";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type RoutineCheck =
  | {
      kind: "market_snapshot";
      symbols: string[];
    }
  | {
      kind: "price_above" | "price_below";
      symbol: string;
      priceUsd: number;
    }
  | {
      /** Recurring observe-only market review that drafts a plan Artifact text. */
      kind: "market_review";
      symbol: string;
      timeframe: "15m" | "1h";
    };

export type ObserveRoutine = {
  id: string;
  ownerId: string;
  name: string;
  check: RoutineCheck;
  everyMinutes: number;
  timezone: string;
  status: "active" | "paused" | "deleted" | "completed";
  nextRunAt: string;
  retryAfter: string | null;
  lease: {
    token: string;
    expiresAt: string;
    scheduledFor: string;
  } | null;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type RoutineObservation = {
  symbol: string;
  priceUsd: number;
  observedAt: string;
  source: "phoenix-public-candles";
};

export type RoutineRun = {
  id: string;
  ownerId: string;
  routineId: string;
  routineVersion: number;
  scheduledFor: string;
  status: "completed" | "failed";
  observations: RoutineObservation[];
  alertId: string | null;
  error: string | null;
  completedAt: string;
};

export type RoutineAlert = {
  id: string;
  ownerId: string;
  routineId: string;
  routineRunId: string;
  severity: "info" | "action-required";
  title: string;
  body: string;
  evidence: RoutineObservation[];
  status: "unread" | "read";
  createdAt: string;
};
