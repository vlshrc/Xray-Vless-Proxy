import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { logger } from "./lib/logger";

export const STATS_GRPC_PORT = 10809;

const PROTO_CONTENT = `
syntax = "proto3";
package xray.app.stats.command;

service StatsService {
  rpc GetStats (GetStatsRequest) returns (GetStatsResponse);
  rpc QueryStats (QueryStatsRequest) returns (QueryStatsResponse);
  rpc GetSysStats (SysStatsRequest) returns (SysStatsResponse);
}

message GetStatsRequest {
  string name = 1;
  bool reset = 2;
}

message GetStatsResponse {
  Stat stat = 1;
}

message QueryStatsRequest {
  string pattern = 1;
  bool reset = 2;
}

message QueryStatsResponse {
  repeated Stat stat = 1;
}

message SysStatsRequest {}

message SysStatsResponse {
  uint32 NumGoroutine = 1;
  uint32 NumGC = 2;
  uint64 Alloc = 3;
  uint64 TotalAlloc = 4;
  uint64 Sys = 5;
  uint64 Mallocs = 6;
  uint64 Frees = 7;
  uint64 LiveObjects = 8;
  uint64 PauseTotalNs = 9;
  uint32 Uptime = 10;
}

message Stat {
  string name = 1;
  int64 value = 2;
}
`;

const PROTO_PATH = "/tmp/xray-data/stats.proto";

let statsClient: grpc.Client | null = null;
let statsService: {
  QueryStats: (req: { pattern: string; reset: boolean }, cb: (err: grpc.ServiceError | null, res: { stat?: Array<{ name: string; value: string | number }> }) => void) => void;
  GetSysStats: (req: Record<string, never>, cb: (err: grpc.ServiceError | null, res: { Uptime?: number; Alloc?: number; Sys?: number }) => void) => void;
} | null = null;

export function initStatsClient(): void {
  try {
    mkdirSync("/tmp/xray-data", { recursive: true });
    writeFileSync(PROTO_PATH, PROTO_CONTENT, "utf-8");

    const pkgDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(pkgDef) as grpc.GrpcObject;
    const pkg = (proto["xray"] as grpc.GrpcObject | undefined)?.["app"] as grpc.GrpcObject | undefined;
    const cmd = (pkg?.["stats"] as grpc.GrpcObject | undefined)?.["command"] as grpc.GrpcObject | undefined;
    const StatsService = cmd?.["StatsService"] as grpc.ServiceClientConstructor | undefined;

    if (!StatsService) {
      logger.warn("StatsService not found in proto definition");
      return;
    }

    statsClient = new StatsService(
      `127.0.0.1:${STATS_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
    );

    statsService = statsClient as unknown as typeof statsService;
    logger.info({ port: STATS_GRPC_PORT }, "xray Stats gRPC client initialized");
  } catch (err) {
    logger.warn({ err }, "Failed to init xray stats gRPC client");
  }
}

export interface UserStat {
  email: string;
  uplink: number;
  downlink: number;
}

export interface SysStat {
  uptime: number;
  allocBytes: number;
  sysBytes: number;
}

export async function queryUserStats(reset = false): Promise<UserStat[]> {
  if (!statsService) return [];

  return new Promise((resolve) => {
    statsService!.QueryStats({ pattern: "user>>>", reset }, (err, res) => {
      if (err || !res?.stat) {
        resolve([]);
        return;
      }

      const map = new Map<string, { uplink: number; downlink: number }>();

      for (const s of res.stat) {
        const val = typeof s.value === "string" ? parseInt(s.value, 10) : (s.value ?? 0);
        const m = s.name.match(/user>>>([^>]+)>>>traffic>>>(uplink|downlink)/);
        if (!m) continue;
        const email = m[1]!;
        const dir = m[2]!;
        if (!map.has(email)) map.set(email, { uplink: 0, downlink: 0 });
        const entry = map.get(email)!;
        if (dir === "uplink") entry.uplink = val;
        else entry.downlink = val;
      }

      resolve(
        Array.from(map.entries()).map(([email, v]) => ({
          email,
          uplink: v.uplink,
          downlink: v.downlink,
        })),
      );
    });
  });
}

export async function querySysStats(): Promise<SysStat | null> {
  if (!statsService) return null;

  return new Promise((resolve) => {
    statsService!.GetSysStats({}, (err, res) => {
      if (err || !res) { resolve(null); return; }
      resolve({
        uptime: res.Uptime ?? 0,
        allocBytes: res.Alloc ?? 0,
        sysBytes: res.Sys ?? 0,
      });
    });
  });
}

export function closeStatsClient(): void {
  if (statsClient) {
    statsClient.close();
    statsClient = null;
    statsService = null;
  }
}
