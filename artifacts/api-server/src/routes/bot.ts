import { Router, type IRouter, type Request, type Response } from "express";
import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { usersTable, paymentsTable, subscriptionsTable, PLANS, type PlanId } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";
import { getHost } from "../xray";

const router: IRouter = Router();
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";

let bot: TelegramBot | null = null;

export function initBot(): TelegramBot | null {
  if (!BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
    return null;
  }
  bot = new TelegramBot(BOT_TOKEN);
  logger.info("Telegram bot instance created (webhook mode)");
  return bot;
}

export function getBot(): TelegramBot | null {
  return bot;
}

// Create Telegram Stars invoice
export async function sendStarsInvoice(
  chatId: number,
  planId: PlanId,
  months = 1,
): Promise<void> {
  if (!bot) return;
  const plan = PLANS.find(p => p.id === planId);
  if (!plan || plan.priceStars === 0) return;

  const total = plan.priceStars * months;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (bot.sendInvoice as any)(
    chatId,
    `${plan.emoji} ${plan.name} × ${months} мес`,
    plan.description,
    JSON.stringify({ planId, months }),
    "",            // provider_token: empty string = Telegram Stars (XTR)
    "XTR",
    [{ label: `${plan.name} × ${months}`, amount: total }],
  );
}

// Webhook handler
router.post("/bot/webhook", async (req: Request, res: Response) => {
  if (!bot) { res.sendStatus(200); return; }

  const update = req.body as TelegramBot.Update;
  res.sendStatus(200); // ack immediately

  try {
    // /start command
    if (update.message?.text?.startsWith("/start") && update.message.chat.id) {
      const chatId = update.message.chat.id;
      const tgId = update.message.from?.id ?? chatId;
      const firstName = update.message.from?.first_name ?? "Пользователь";

      const host = getHost();
      const appUrl = `https://${host}`;

      await bot.sendMessage(chatId,
        `👋 Привет, ${firstName}!\n\nЭто VLESS VPN сервис.\nНажмите кнопку ниже чтобы открыть приложение.`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: "🔒 Открыть приложение", web_app: { url: appUrl } },
            ]],
          },
        },
      );
      logger.info({ tgId }, "Bot /start handled");
    }

    // Pre-checkout: always approve
    if (update.pre_checkout_query) {
      await bot.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
    }

    // Successful payment
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const tgId = update.message.from?.id;
      if (!tgId) return;

      const payload = JSON.parse(payment.invoice_payload) as { planId: PlanId; months: number };
      const plan = PLANS.find(p => p.id === payload.planId);
      if (!plan) return;

      const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.telegramId, tgId),
      });
      if (!user) return;

      // Deactivate old subs
      await db.update(subscriptionsTable)
        .set({ active: false })
        .where(and(
          eq(subscriptionsTable.userId, user.id),
          eq(subscriptionsTable.active, true),
        ));

      const uuid = randomUUID();
      const host = getHost();
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + payload.months);

      await db.insert(subscriptionsTable).values({
        userId: user.id,
        planId: payload.planId,
        uuid,
        serverId: "replit-main",
        serverHost: host,
        wsPath: "/ws",
        active: true,
        expiresAt,
      });

      await db.insert(paymentsTable).values({
        userId: user.id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        planId: payload.planId,
        stars: payment.total_amount,
        months: payload.months,
        status: "completed",
      });

      await bot.sendMessage(update.message.chat.id,
        `✅ Оплата принята! Тариф *${plan.name}* активирован.\n\nОткройте приложение чтобы получить конфиг.`,
        { parse_mode: "Markdown" },
      );
      logger.info({ tgId, planId: payload.planId, uuid }, "Payment completed via bot");
    }
  } catch (err) {
    logger.error({ err }, "Bot webhook error");
  }
});

// POST /api/bot/invoice — create invoice from Mini App
router.post("/bot/invoice", async (req: Request, res: Response) => {
  const { chatId, planId, months = 1 } = req.body as {
    chatId: number;
    planId: PlanId;
    months?: number;
  };

  if (!bot) { res.status(503).json({ ok: false, error: "Bot not configured" }); return; }

  try {
    await sendStarsInvoice(chatId, planId, months);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
