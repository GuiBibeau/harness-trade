import { randomUUID } from "node:crypto";
import {
  listPrivateObjects,
  ownerPartition,
  readPrivateJson,
  updatePrivateJson,
  writePrivateJson,
} from "./blob-json";
import type {
  ObserveRoutine,
  RoutineAlert,
  RoutineCheck,
  RoutineRun,
} from "./persistent-types";

const ROUTINE_ROOT = "agent-state/v1/routines";
const RUN_ROOT = "agent-state/v1/routine-runs";
const ALERT_ROOT = "agent-state/v1/alerts";
const MAX_ROUTINES_PER_USER = 25;
const MAX_ROUTINE_OBJECTS_PER_USER = 250;
const MAX_ALERTS_PER_USER = 100;

function routinePrefix(ownerId: string): string {
  return `${ROUTINE_ROOT}/${ownerPartition(ownerId)}/`;
}

function routinePath(ownerId: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("routine-id-invalid");
  return `${routinePrefix(ownerId)}${id}.json`;
}

function runPath(run: RoutineRun): string {
  return `${RUN_ROOT}/${ownerPartition(run.ownerId)}/${run.routineId}/${encodeURIComponent(run.scheduledFor)}.json`;
}

function alertPath(alert: RoutineAlert): string {
  return `${ALERT_ROOT}/${ownerPartition(alert.ownerId)}/${alert.id}.json`;
}

function validateCheck(check: RoutineCheck): RoutineCheck {
  if (check.kind === "market_snapshot") {
    const symbols = [...new Set(check.symbols.map(normalizeSymbol))].slice(
      0,
      8,
    );
    if (symbols.length === 0) throw new Error("routine-symbols-required");
    return { kind: check.kind, symbols };
  }
  if (check.kind === "market_review") {
    const timeframe = check.timeframe === "1h" ? "1h" : "15m";
    return {
      kind: "market_review",
      symbol: normalizeSymbol(check.symbol),
      timeframe,
    };
  }
  if (!Number.isFinite(check.priceUsd) || check.priceUsd <= 0) {
    throw new Error("routine-price-invalid");
  }
  return {
    kind: check.kind,
    symbol: normalizeSymbol(check.symbol),
    priceUsd: check.priceUsd,
  };
}

function normalizeSymbol(value: string): string {
  const symbol = value
    .trim()
    .toUpperCase()
    .replace(/-PERP$/, "");
  if (!/^[A-Z0-9._-]{1,16}$/.test(symbol)) {
    throw new Error("routine-symbol-invalid");
  }
  return symbol;
}

function validateTimezone(value: string): string {
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("routine-timezone-invalid");
  }
  return timezone;
}

function validateName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 100) {
    throw new Error("routine-name-invalid");
  }
  return name;
}

function nextAfter(
  scheduledFor: string,
  everyMinutes: number,
  now: Date,
): string {
  const interval = everyMinutes * 60_000;
  const scheduled = Date.parse(scheduledFor);
  if (!Number.isFinite(scheduled)) throw new Error("routine-schedule-invalid");
  const jumps = Math.max(
    1,
    Math.floor((now.getTime() - scheduled) / interval) + 1,
  );
  return new Date(scheduled + jumps * interval).toISOString();
}

export const routineStore = {
  async create(
    ownerId: string,
    input: {
      name: string;
      check: RoutineCheck;
      everyMinutes: number;
      timezone: string;
      firstRunAt: string;
    },
  ): Promise<ObserveRoutine> {
    const existing = await this.list(ownerId);
    if (
      existing.filter((row) => row.status !== "deleted").length >=
      MAX_ROUTINES_PER_USER
    ) {
      throw new Error("routine-limit-reached");
    }
    const firstRunAt = new Date(input.firstRunAt);
    if (!Number.isFinite(firstRunAt.getTime())) {
      throw new Error("routine-first-run-invalid");
    }
    const now = new Date().toISOString();
    const routine: ObserveRoutine = {
      id: randomUUID(),
      ownerId,
      name: validateName(input.name),
      check: validateCheck(input.check),
      everyMinutes: input.everyMinutes,
      timezone: validateTimezone(input.timezone),
      status: "active",
      nextRunAt: firstRunAt.toISOString(),
      retryAfter: null,
      lease: null,
      lastRunAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await writePrivateJson(routinePath(ownerId, routine.id), routine);
    return routine;
  },

  async list(ownerId: string): Promise<ObserveRoutine[]> {
    const objects = await listPrivateObjects({
      prefix: routinePrefix(ownerId),
      limit: MAX_ROUTINE_OBJECTS_PER_USER,
    });
    const rows = await Promise.all(
      objects.blobs.map(async (blob) => {
        const stored = await readPrivateJson<ObserveRoutine>(blob.pathname);
        return stored?.value ?? null;
      }),
    );
    return rows
      .filter(
        (row): row is ObserveRoutine =>
          row !== null && row.ownerId === ownerId && row.status !== "deleted",
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async update(
    ownerId: string,
    id: string,
    patch: {
      name?: string;
      check?: RoutineCheck;
      everyMinutes?: number;
      timezone?: string;
      nextRunAt?: string;
      status?: "active" | "paused" | "deleted";
    },
  ): Promise<ObserveRoutine> {
    return await updatePrivateJson<ObserveRoutine>(
      routinePath(ownerId, id),
      (current) => {
        if (current.ownerId !== ownerId)
          throw new Error("routine-owner-mismatch");
        if (current.status === "deleted") throw new Error("routine-deleted");
        const nextRunAt = patch.nextRunAt
          ? new Date(patch.nextRunAt).toISOString()
          : current.nextRunAt;
        return {
          ...current,
          ...(patch.name ? { name: validateName(patch.name) } : {}),
          ...(patch.check ? { check: validateCheck(patch.check) } : {}),
          ...(patch.everyMinutes ? { everyMinutes: patch.everyMinutes } : {}),
          ...(patch.timezone
            ? { timezone: validateTimezone(patch.timezone) }
            : {}),
          ...(patch.status ? { status: patch.status } : {}),
          nextRunAt,
          retryAfter: null,
          lease: null,
          updatedAt: new Date().toISOString(),
          version: current.version + 1,
        };
      },
    );
  },

  async listAlerts(ownerId: string, limit = 50): Promise<RoutineAlert[]> {
    const objects = await listPrivateObjects({
      prefix: `${ALERT_ROOT}/${ownerPartition(ownerId)}/`,
      limit: Math.min(Math.max(limit, 1), MAX_ALERTS_PER_USER),
    });
    const rows = await Promise.all(
      objects.blobs.map(async (blob) => {
        const stored = await readPrivateJson<RoutineAlert>(blob.pathname);
        return stored?.value ?? null;
      }),
    );
    return rows
      .filter(
        (row): row is RoutineAlert => row !== null && row.ownerId === ownerId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async markAlertRead(ownerId: string, id: string): Promise<boolean> {
    const path = `${ALERT_ROOT}/${ownerPartition(ownerId)}/${id}.json`;
    const stored = await readPrivateJson<RoutineAlert>(path);
    if (!stored || stored.value.ownerId !== ownerId) return false;
    await updatePrivateJson<RoutineAlert>(path, (current) => ({
      ...current,
      status: "read",
    }));
    return true;
  },

  async writeOutcome(
    run: RoutineRun,
    alert: RoutineAlert | null,
  ): Promise<void> {
    // Deterministic paths make schedule retries converge on the same logical
    // run and alert. These records are observational only.
    await writePrivateJson(runPath(run), run, { overwrite: true });
    if (alert)
      await writePrivateJson(alertPath(alert), alert, { overwrite: true });
  },

  async completeClaim(
    routine: ObserveRoutine,
    leaseToken: string,
    now: Date,
    error: string | null,
  ): Promise<void> {
    await updatePrivateJson<ObserveRoutine>(
      routinePath(routine.ownerId, routine.id),
      (current) => {
        if (current.lease?.token !== leaseToken) {
          throw new Error("routine-lease-lost");
        }
        return {
          ...current,
          lease: null,
          lastRunAt: error ? current.lastRunAt : now.toISOString(),
          lastError: error,
          retryAfter: error
            ? new Date(now.getTime() + 5 * 60_000).toISOString()
            : null,
          nextRunAt: error
            ? current.nextRunAt
            : nextAfter(current.lease.scheduledFor, current.everyMinutes, now),
          updatedAt: now.toISOString(),
          version: current.version + 1,
        };
      },
    );
  },
};

export { ROUTINE_ROOT, routinePath };
