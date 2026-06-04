import { Router, type IRouter } from "express";
import { queryUserStats, querySysStats } from "../xray-stats";
import { getUsers, getHost } from "../xray";
import { trafficStats } from "../index";
import { loadLimits, updateUserLimit, ensureUserLimits } from "../limits";
import { reloadXray } from "../xray";
import { getExceededUsers } from "../limits";
import os from "node:os";

const router: IRouter = Router();

router.get("/metrics", async (_req, res) => {
  const [userStats, sysStats] = await Promise.all([
    queryUserStats(false),
    querySysStats(),
  ]);

  const users = getUsers();
  const limits = loadLimits();

  const userMetrics = users.map((u, i) => {
    const email = `user${i + 1}@proxy`;
    const stat = userStats.find((s) => s.email === email);
    const limitData = limits.users.find((l) => l.uuid === u.uuid);
    const usageData = limits.usage.find((x) => x.uuid === u.uuid);

    const bytesUp = stat?.uplink ?? 0;
    const bytesDown = stat?.downlink ?? 0;
    const monthlyGbLimit = limitData?.monthlyGbLimit ?? null;
    const totalBytes = bytesUp + bytesDown;
    const limitBytes = monthlyGbLimit ? monthlyGbLimit * 1024 ** 3 : null;

    return {
      uuid: u.uuid,
      label: u.label,
      email,
      enabled: limitData?.enabled ?? true,
      bytesUp,
      bytesDown,
      speedMbps: limitData?.speedMbps ?? null,
      monthlyGbLimit,
      monthlyUsedBytes: usageData ? usageData.bytesUp + usageData.bytesDown : totalBytes,
      limitExceeded: limitBytes !== null && totalBytes > limitBytes,
      resetAt: usageData?.resetAt ?? null,
    };
  });

  const uptimeSeconds = Math.floor((Date.now() - trafficStats.startTime) / 1000);
  const freeMem = os.freemem();
  const totalMem = os.totalmem();

  res.json({
    server: {
      host: getHost(),
      uptimeSeconds,
      xrayUptime: sysStats?.uptime ?? null,
      activeConnections: trafficStats.activeConnections,
      totalConnections: trafficStats.totalConnections,
      bytesIn: trafficStats.bytesIn,
      bytesOut: trafficStats.bytesOut,
      memFreeBytes: freeMem,
      memTotalBytes: totalMem,
      memUsedPct: Math.round((1 - freeMem / totalMem) * 100),
      xrayAllocBytes: sysStats?.allocBytes ?? null,
    },
    users: userMetrics,
  });
});

router.patch("/metrics/users/:uuid/limits", async (req, res) => {
  const uuid = Array.isArray(req.params["uuid"]) ? req.params["uuid"][0]! : req.params["uuid"]!;
  const { monthlyGbLimit, speedMbps, enabled } = req.body as {
    monthlyGbLimit?: number | null;
    speedMbps?: number | null;
    enabled?: boolean;
  };

  const users = getUsers();
  const user = users.find((u) => u.uuid === uuid);
  if (!user) { res.status(404).json({ ok: false, error: "User not found" }); return; }

  ensureUserLimits(uuid, user.label);

  const patch: Parameters<typeof updateUserLimit>[1] = {};
  if (monthlyGbLimit !== undefined) patch.monthlyGbLimit = monthlyGbLimit;
  if (speedMbps !== undefined) patch.speedMbps = speedMbps;
  if (enabled !== undefined) patch.enabled = enabled;

  const updated = updateUserLimit(uuid, patch);

  const exceeded = getExceededUsers();
  await reloadXray(exceeded);

  res.json({ ok: true, limit: updated });
});

export default router;
