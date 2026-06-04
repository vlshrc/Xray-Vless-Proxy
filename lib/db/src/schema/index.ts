import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  serial,
  bigint,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Users ───────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ─── Plans ───────────────────────────────────────────────────────────────────

export const PLAN_IDS = ["basic", "pro", "unlimited", "self_hosted"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDef {
  id: PlanId;
  name: string;
  emoji: string;
  monthlyGb: number | null;
  devices: number;
  speedMbps: number | null;
  priceStars: number;
  description: string;
}

export const PLANS: PlanDef[] = [
  {
    id: "basic",
    name: "Базовый",
    emoji: "🌱",
    monthlyGb: 10,
    devices: 1,
    speedMbps: 50,
    priceStars: 50,
    description: "10 GB/мес · 1 устройство · до 50 Mbps",
  },
  {
    id: "pro",
    name: "Pro",
    emoji: "⚡",
    monthlyGb: 50,
    devices: 3,
    speedMbps: null,
    priceStars: 150,
    description: "50 GB/мес · 3 устройства · без лимита скорости",
  },
  {
    id: "unlimited",
    name: "Безлимит",
    emoji: "♾️",
    monthlyGb: null,
    devices: 5,
    speedMbps: null,
    priceStars: 400,
    description: "∞ трафик · 5 устройств · без лимита скорости",
  },
  {
    id: "self_hosted",
    name: "Self-Hosted",
    emoji: "🖥️",
    monthlyGb: null,
    devices: 999,
    speedMbps: null,
    priceStars: 0,
    description: "Свой сервер · полный контроль · данные только у вас",
  },
];

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  planId: text("plan_id").notNull(),
  uuid: text("uuid").notNull(),
  serverId: text("server_id").notNull().default("replit-main"),
  serverHost: text("server_host"),
  wsPath: text("ws_path").notNull().default("/ws"),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

// ─── Payments ─────────────────────────────────────────────────────────────────

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  telegramPaymentChargeId: text("telegram_payment_charge_id"),
  planId: text("plan_id").notNull(),
  stars: integer("stars").notNull(),
  months: integer("months").notNull().default(1),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Payment = typeof paymentsTable.$inferSelect;

// ─── Usage ────────────────────────────────────────────────────────────────────

export const usageTable = pgTable("usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id),
  bytesUp: bigint("bytes_up", { mode: "number" }).notNull().default(0),
  bytesDown: bigint("bytes_down", { mode: "number" }).notNull().default(0),
  resetAt: timestamp("reset_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Usage = typeof usageTable.$inferSelect;
