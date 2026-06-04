import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logger } from "./lib/logger";

const LIMITS_DIR = path.join(process.cwd(), "xray-data");
const LIMITS_FILE = path.join(LIMITS_DIR, "limits.json");

export interface UserLimit {
  uuid: string;
  label: string;
  enabled: boolean;
  monthlyGbLimit: number | null;
  speedMbps: number | null;
  resetDay: number;
}

export interface UserUsage {
  uuid: string;
  bytesUp: number;
  bytesDown: number;
  resetAt: string;
}

export interface LimitsStore {
  users: UserLimit[];
  usage: UserUsage[];
}

function defaultStore(): LimitsStore {
  return { users: [], usage: [] };
}

export function loadLimits(): LimitsStore {
  if (!existsSync(LIMITS_FILE)) return defaultStore();
  try {
    return JSON.parse(readFileSync(LIMITS_FILE, "utf-8")) as LimitsStore;
  } catch {
    return defaultStore();
  }
}

export function saveLimits(store: LimitsStore): void {
  mkdirSync(LIMITS_DIR, { recursive: true });
  writeFileSync(LIMITS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function ensureUserLimits(uuid: string, label: string): void {
  const store = loadLimits();
  if (!store.users.find((u) => u.uuid === uuid)) {
    store.users.push({
      uuid,
      label,
      enabled: true,
      monthlyGbLimit: null,
      speedMbps: null,
      resetDay: 1,
    });
    saveLimits(store);
  }
}

export function getUserLimit(uuid: string): UserLimit | undefined {
  return loadLimits().users.find((u) => u.uuid === uuid);
}

export function updateUserLimit(uuid: string, patch: Partial<UserLimit>): UserLimit {
  const store = loadLimits();
  const idx = store.users.findIndex((u) => u.uuid === uuid);
  if (idx === -1) throw new Error(`User ${uuid} not found in limits`);
  store.users[idx] = { ...store.users[idx]!, ...patch };
  saveLimits(store);
  return store.users[idx]!;
}

export function addUsage(uuid: string, bytesUp: number, bytesDown: number): void {
  const store = loadLimits();
  let entry = store.usage.find((u) => u.uuid === uuid);
  if (!entry) {
    entry = { uuid, bytesUp: 0, bytesDown: 0, resetAt: nextResetDate(1) };
    store.usage.push(entry);
  }

  if (shouldReset(entry.resetAt)) {
    const limit = store.users.find((u) => u.uuid === uuid);
    entry.bytesUp = 0;
    entry.bytesDown = 0;
    entry.resetAt = nextResetDate(limit?.resetDay ?? 1);
    logger.info({ uuid }, "Monthly usage reset");
  }

  entry.bytesUp += bytesUp;
  entry.bytesDown += bytesDown;
  saveLimits(store);
}

export function syncUsageFromStats(
  statsMap: Map<string, { uplink: number; downlink: number }>,
): void {
  const store = loadLimits();
  for (const u of store.users) {
    const s = statsMap.get(`user${store.users.indexOf(u) + 1}@proxy`);
    if (!s) continue;
    let entry = store.usage.find((x) => x.uuid === u.uuid);
    if (!entry) {
      entry = { uuid: u.uuid, bytesUp: 0, bytesDown: 0, resetAt: nextResetDate(u.resetDay) };
      store.usage.push(entry);
    }
    if (shouldReset(entry.resetAt)) {
      entry.bytesUp = 0;
      entry.bytesDown = 0;
      entry.resetAt = nextResetDate(u.resetDay);
    }
    entry.bytesUp = s.uplink;
    entry.bytesDown = s.downlink;
  }
  saveLimits(store);
}

export function getExceededUsers(): string[] {
  const store = loadLimits();
  const exceeded: string[] = [];
  for (const u of store.users) {
    if (!u.enabled) { exceeded.push(u.uuid); continue; }
    if (u.monthlyGbLimit === null) continue;
    const usage = store.usage.find((x) => x.uuid === u.uuid);
    if (!usage) continue;
    const totalBytes = usage.bytesUp + usage.bytesDown;
    if (totalBytes > u.monthlyGbLimit * 1024 * 1024 * 1024) {
      exceeded.push(u.uuid);
    }
  }
  return exceeded;
}

function nextResetDate(day: number): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, day);
  return next.toISOString();
}

function shouldReset(resetAt: string): boolean {
  return new Date() >= new Date(resetAt);
}
