import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  subscriptionsTable,
  usageTable,
  paymentsTable,
  PLANS,
  type PlanId,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getHost } from "../xray";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/user/me — subscription + usage
router.get("/user/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.jwtUser!.userId;

  const sub = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.userId, userId),
      eq(subscriptionsTable.active, true),
    ),
    orderBy: [desc(subscriptionsTable.createdAt)],
  });

  if (!sub) {
    res.json({ ok: true, subscription: null, usage: null });
    return;
  }

  const usage = await db.query.usageTable.findFirst({
    where: eq(usageTable.subscriptionId, sub.id),
  });

  const plan = PLANS.find(p => p.id === sub.planId);
  const host = sub.serverHost ?? getHost();
  const vlessLink = `vless://${sub.uuid}@${host}:443?encryption=none&security=tls&type=ws&path=${encodeURIComponent(sub.wsPath)}#My+VPN`;

  res.json({
    ok: true,
    subscription: {
      ...sub,
      plan,
      vlessLink,
      serverHost: host,
    },
    usage: usage ? {
      bytesUp: Number(usage.bytesUp),
      bytesDown: Number(usage.bytesDown),
      resetAt: usage.resetAt,
    } : { bytesUp: 0, bytesDown: 0, resetAt: null },
  });
});

// GET /api/user/plans
router.get("/user/plans", (_req: Request, res: Response) => {
  res.json({ ok: true, plans: PLANS });
});

// POST /api/user/subscribe — called after successful Stars payment
router.post("/user/subscribe", requireAuth, async (req: Request, res: Response) => {
  const userId = req.jwtUser!.userId;
  const { planId, telegramPaymentChargeId, months = 1 } = req.body as {
    planId: PlanId;
    telegramPaymentChargeId?: string;
    months?: number;
  };

  const plan = PLANS.find(p => p.id === planId);
  if (!plan) {
    res.status(400).json({ ok: false, error: "Unknown plan" });
    return;
  }

  // Deactivate existing active subscriptions
  await db.update(subscriptionsTable)
    .set({ active: false })
    .where(and(
      eq(subscriptionsTable.userId, userId),
      eq(subscriptionsTable.active, true),
    ));

  const uuid = randomUUID();
  const host = getHost();
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + months);

  const [sub] = await db.insert(subscriptionsTable).values({
    userId,
    planId,
    uuid,
    serverId: "replit-main",
    serverHost: host,
    wsPath: "/ws",
    active: true,
    expiresAt,
  }).returning();

  // Log payment
  if (telegramPaymentChargeId || plan.priceStars > 0) {
    await db.insert(paymentsTable).values({
      userId,
      telegramPaymentChargeId: telegramPaymentChargeId ?? null,
      planId,
      stars: plan.priceStars * months,
      months,
      status: "completed",
    });
  }

  // Init usage row
  const resetAt = new Date();
  resetAt.setMonth(resetAt.getMonth() + 1);
  resetAt.setDate(1);
  await db.insert(usageTable).values({
    userId,
    subscriptionId: sub!.id,
    bytesUp: 0,
    bytesDown: 0,
    resetAt,
  });

  logger.info({ userId, planId, uuid }, "Subscription created");

  const vlessLink = `vless://${uuid}@${host}:443?encryption=none&security=tls&type=ws&path=%2Fws#My+VPN`;
  res.json({ ok: true, subscription: { ...sub, plan, vlessLink } });
});

// POST /api/user/self-hosted — register self-hosted server config
router.post("/user/self-hosted", requireAuth, async (req: Request, res: Response) => {
  const userId = req.jwtUser!.userId;
  const { host, wsPath, uuid } = req.body as {
    host: string;
    wsPath: string;
    uuid: string;
  };

  if (!host || !wsPath || !uuid) {
    res.status(400).json({ ok: false, error: "host, wsPath, uuid required" });
    return;
  }

  await db.update(subscriptionsTable)
    .set({ active: false })
    .where(and(
      eq(subscriptionsTable.userId, userId),
      eq(subscriptionsTable.active, true),
    ));

  const [sub] = await db.insert(subscriptionsTable).values({
    userId,
    planId: "self_hosted",
    uuid,
    serverId: "self-hosted",
    serverHost: host,
    wsPath,
    active: true,
    expiresAt: null,
  }).returning();

  logger.info({ userId, host, uuid }, "Self-hosted subscription registered");

  const vlessLink = `vless://${uuid}@${host}:443?encryption=none&security=tls&type=ws&path=${encodeURIComponent(wsPath)}#My+VPN`;
  res.json({ ok: true, subscription: { ...sub, vlessLink } });
});

export default router;
