import { randomUUID } from "node:crypto";
import {
  listPrivateObjects,
  readPrivateJson,
  writePrivateJson,
} from "./blob-json";
import type {
  ObserveRoutine,
  RoutineAlert,
  RoutineObservation,
  RoutineRun,
} from "./persistent-types";
import {
  buildMarketReviewPlan,
  type CandleClose,
  formatMarketReviewAlertBody,
} from "./routine-review";
import { ROUTINE_ROOT, routinePath, routineStore } from "./routine-store";

const MAX_SCAN = 200;
const MAX_CLAIMS = 12;
const LEASE_MS = 4 * 60_000;
const CURSOR_PATH = "agent-state/v1/system/routine-sweep-cursor.json";
const REVIEW_CANDLE_LIMIT = 24;

type SweepCursor = { cursor: string | null; updatedAt: string };
type Claimed = { routine: ObserveRoutine; leaseToken: string };

async function loadCursor(): Promise<string | undefined> {
  try {
    return (
      (await readPrivateJson<SweepCursor>(CURSOR_PATH))?.value.cursor ??
      undefined
    );
  } catch {
    return undefined;
  }
}

async function saveCursor(cursor: string | undefined): Promise<void> {
  await writePrivateJson(
    CURSOR_PATH,
    { cursor: cursor ?? null, updatedAt: new Date().toISOString() },
    { overwrite: true },
  );
}

async function claim(pathname: string, now: Date): Promise<Claimed | null> {
  const stored = await readPrivateJson<ObserveRoutine>(pathname);
  if (!stored) return null;
  const routine = stored.value;
  const due = Date.parse(routine.nextRunAt) <= now.getTime();
  const retryReady =
    !routine.retryAfter || Date.parse(routine.retryAfter) <= now.getTime();
  const leaseExpired =
    !routine.lease || Date.parse(routine.lease.expiresAt) <= now.getTime();
  if (routine.status !== "active" || !due || !retryReady || !leaseExpired) {
    return null;
  }
  const leaseToken = randomUUID();
  const claimed: ObserveRoutine = {
    ...routine,
    lease: {
      token: leaseToken,
      expiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
      scheduledFor: routine.nextRunAt,
    },
    updatedAt: now.toISOString(),
    version: routine.version + 1,
  };
  try {
    await writePrivateJson(routinePath(routine.ownerId, routine.id), claimed, {
      etag: stored.etag,
    });
    return { routine: claimed, leaseToken };
  } catch {
    // Another overlapping static sweep won the optimistic claim.
    return null;
  }
}

async function fetchCandles(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<CandleClose[]> {
  const query = new URLSearchParams({
    symbol,
    timeframe,
    limit: String(limit),
  });
  const response = await fetch(
    `https://perp-api.phoenix.trade/candles?${query}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!response.ok) throw new Error(`routine-market-${response.status}`);
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("routine-market-malformed");
  }
  const candles: CandleClose[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const high = Number(record.high);
    const low = Number(record.low);
    const close = Number(record.close);
    if (
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      high > 0 &&
      low > 0 &&
      close > 0
    ) {
      candles.push({ high, low, close });
    }
  }
  if (candles.length === 0) throw new Error("routine-market-price-invalid");
  return candles;
}

async function marketPrice(symbol: string): Promise<RoutineObservation> {
  const candles = await fetchCandles(symbol, "1m", 2);
  const latest = candles.at(-1);
  if (!latest) throw new Error("routine-market-price-invalid");
  return {
    symbol,
    priceUsd: latest.close,
    observedAt: new Date().toISOString(),
    source: "phoenix-public-candles",
  };
}

async function observe(routine: ObserveRoutine): Promise<{
  observations: RoutineObservation[];
  alert: RoutineAlert | null;
}> {
  if (routine.check.kind === "market_review") {
    const timeframe = routine.check.timeframe;
    const candles = await fetchCandles(
      routine.check.symbol,
      timeframe,
      REVIEW_CANDLE_LIMIT,
    );
    const plan = buildMarketReviewPlan({
      symbol: routine.check.symbol,
      timeframe,
      candles,
    });
    const observation: RoutineObservation = {
      symbol: routine.check.symbol,
      priceUsd: plan.lastClose,
      observedAt: new Date().toISOString(),
      source: "phoenix-public-candles",
    };
    const scheduledFor = routine.lease?.scheduledFor ?? routine.nextRunAt;
    const runId = `${routine.id}:${scheduledFor}`;
    return {
      observations: [observation],
      alert: {
        id: runId,
        ownerId: routine.ownerId,
        routineId: routine.id,
        routineRunId: runId,
        severity: "info",
        title: `${routine.name} · ${plan.bias}`,
        body: formatMarketReviewAlertBody(plan),
        evidence: [observation],
        status: "unread",
        createdAt: scheduledFor,
      },
    };
  }

  const symbols =
    routine.check.kind === "market_snapshot"
      ? routine.check.symbols
      : [routine.check.symbol];
  const observations = await Promise.all(symbols.map(marketPrice));
  const scheduledFor = routine.lease?.scheduledFor ?? routine.nextRunAt;
  const runId = `${routine.id}:${scheduledFor}`;

  if (routine.check.kind === "market_snapshot") {
    const summary = observations
      .map((row) => `${row.symbol} $${row.priceUsd.toLocaleString("en-US")}`)
      .join(" · ");
    return {
      observations,
      alert: {
        id: runId,
        ownerId: routine.ownerId,
        routineId: routine.id,
        routineRunId: runId,
        severity: "info",
        title: routine.name,
        body: summary,
        evidence: observations,
        status: "unread",
        createdAt: scheduledFor,
      },
    };
  }

  const observed = observations[0];
  if (!observed) throw new Error("routine-observation-missing");
  const triggered =
    routine.check.kind === "price_above"
      ? observed.priceUsd >= routine.check.priceUsd
      : observed.priceUsd <= routine.check.priceUsd;
  if (!triggered) return { observations, alert: null };
  const direction =
    routine.check.kind === "price_above" ? "at or above" : "at or below";
  return {
    observations,
    alert: {
      id: runId,
      ownerId: routine.ownerId,
      routineId: routine.id,
      routineRunId: runId,
      severity: "action-required",
      title: routine.name,
      body: `${observed.symbol} is $${observed.priceUsd.toLocaleString("en-US")}, ${direction} $${routine.check.priceUsd.toLocaleString("en-US")}.`,
      evidence: observations,
      status: "unread",
      createdAt: scheduledFor,
    },
  };
}

async function runClaim(claimed: Claimed, now: Date): Promise<void> {
  const scheduledFor =
    claimed.routine.lease?.scheduledFor ?? claimed.routine.nextRunAt;
  const runId = `${claimed.routine.id}:${scheduledFor}`;
  let failure: string | null = null;
  try {
    const output = await observe(claimed.routine);
    const run: RoutineRun = {
      id: runId,
      ownerId: claimed.routine.ownerId,
      routineId: claimed.routine.id,
      routineVersion: claimed.routine.version,
      scheduledFor,
      status: "completed",
      observations: output.observations,
      alertId: output.alert?.id ?? null,
      error: null,
      completedAt: new Date().toISOString(),
    };
    await routineStore.writeOutcome(run, output.alert);
  } catch (error) {
    failure = error instanceof Error ? error.message : "routine-run-failed";
    const run: RoutineRun = {
      id: runId,
      ownerId: claimed.routine.ownerId,
      routineId: claimed.routine.id,
      routineVersion: claimed.routine.version,
      scheduledFor,
      status: "failed",
      observations: [],
      alertId: null,
      error: failure,
      completedAt: new Date().toISOString(),
    };
    await routineStore.writeOutcome(run, null);
  }
  await routineStore.completeClaim(
    claimed.routine,
    claimed.leaseToken,
    now,
    failure,
  );
}

export async function sweepObserveRoutines(now = new Date()): Promise<{
  scanned: number;
  claimed: number;
}> {
  const cursor = await loadCursor();
  let page: Awaited<ReturnType<typeof listPrivateObjects>>;
  try {
    page = await listPrivateObjects({
      prefix: `${ROUTINE_ROOT}/`,
      limit: MAX_SCAN,
      ...(cursor ? { cursor } : {}),
    });
  } catch {
    page = await listPrivateObjects({
      prefix: `${ROUTINE_ROOT}/`,
      limit: MAX_SCAN,
    });
  }

  const claimed: Claimed[] = [];
  for (const blob of page.blobs) {
    if (claimed.length >= MAX_CLAIMS) break;
    const row = await claim(blob.pathname, now);
    if (row) claimed.push(row);
  }

  await saveCursor(page.hasMore ? page.cursor : undefined);
  await Promise.all(claimed.map((row) => runClaim(row, now)));
  return { scanned: page.blobs.length, claimed: claimed.length };
}
