import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "fallback-dev-secret";
const ADMIN_TG_ID = Number(process.env["ADMIN_TELEGRAM_ID"] ?? "0");

export interface JwtPayload {
  userId: number;
  telegramId: number;
  isAdmin: boolean;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function verifyTelegramInitData(initData: string): Record<string, string> | null {
  if (!BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (expectedHash !== hash) return null;

  const result: Record<string, string> = {};
  for (const [k, v] of params.entries()) result[k] = v;
  result["hash"] = hash;
  return result;
}

router.post("/auth/telegram", async (req: Request, res: Response) => {
  const { initData, devTelegramId } = req.body as {
    initData?: string;
    devTelegramId?: number;
  };

  let telegramId: number;
  let firstName = "Пользователь";
  let username: string | undefined;

  if (devTelegramId && process.env["NODE_ENV"] === "development") {
    telegramId = devTelegramId;
    firstName = "Dev User";
  } else if (initData) {
    const verified = verifyTelegramInitData(initData);
    if (!verified) {
      res.status(401).json({ ok: false, error: "Invalid Telegram initData" });
      return;
    }
    const userObj = JSON.parse(verified["user"] ?? "{}") as {
      id?: number;
      first_name?: string;
      username?: string;
    };
    if (!userObj.id) {
      res.status(400).json({ ok: false, error: "No user in initData" });
      return;
    }
    telegramId = userObj.id;
    firstName = userObj.first_name ?? "Пользователь";
    username = userObj.username;
  } else {
    res.status(400).json({ ok: false, error: "initData required" });
    return;
  }

  const isAdmin = telegramId === ADMIN_TG_ID;

  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.telegramId, telegramId),
  });

  if (!user) {
    const [created] = await db.insert(usersTable).values({
      telegramId,
      firstName,
      username,
      isAdmin,
    }).returning();
    user = created!;
    logger.info({ telegramId, isAdmin }, "New user registered");
  } else if (user.isAdmin !== isAdmin) {
    await db.update(usersTable)
      .set({ isAdmin, firstName, username })
      .where(eq(usersTable.id, user.id));
    user = { ...user, isAdmin, firstName, username: username ?? user.username };
  }

  const token = jwt.sign(
    { userId: user.id, telegramId, isAdmin } satisfies JwtPayload,
    JWT_SECRET,
    { expiresIn: "30d" },
  );

  res.json({ ok: true, token, user: { id: user.id, telegramId, firstName, username, isAdmin } });
});

export default router;
