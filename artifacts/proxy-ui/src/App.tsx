import { useEffect, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AreaChart, Area, Tooltip, ResponsiveContainer } from "recharts";

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
        colorScheme: "light" | "dark";
        themeParams: { bg_color?: string; text_color?: string; hint_color?: string; button_color?: string; button_text_color?: string };
        MainButton: { text: string; show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void; showProgress(leaveActive?: boolean): void; hideProgress(): void };
        BackButton: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
        HapticFeedback: { impactOccurred(style: "light" | "medium" | "heavy"): void; notificationOccurred(type: "success" | "error" | "warning"): void };
        expand(): void;
        ready(): void;
        close(): void;
      };
    };
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface TgUser { id: number; first_name?: string; username?: string }
interface AuthUser { id: number; telegramId: number; firstName: string; username?: string; isAdmin: boolean }
interface PlanDef { id: string; name: string; emoji: string; monthlyGb: number | null; devices: number; speedMbps: number | null; priceStars: number; description: string }
interface Subscription { id: number; planId: string; uuid: string; serverHost: string; wsPath: string; active: boolean; expiresAt: string | null; vlessLink: string; plan?: PlanDef }
interface Usage { bytesUp: number; bytesDown: number; resetAt: string | null }
interface UserLink { label: string; uuid: string; vlessLink: string }
interface VlessInfo { host: string; users: UserLink[]; stats: { totalConnections: number; activeConnections: number; bytesIn: number; bytesOut: number; uptimeSeconds: number } }
interface UserMetric { uuid: string; label: string; enabled: boolean; bytesUp: number; bytesDown: number; monthlyGbLimit: number | null; monthlyUsedBytes: number; limitExceeded: boolean; resetAt: string | null }
interface ServerMetric { host: string; uptimeSeconds: number; xrayUptime: number | null; activeConnections: number; totalConnections: number; bytesIn: number; bytesOut: number; memUsedPct: number; memFreeBytes: number; memTotalBytes: number; xrayAllocBytes: number | null }
interface MetricsResponse { server: ServerMetric; users: UserMetric[] }
interface ServerSettings { id: string; name: string; enabled: boolean; routing: { ruDirect: boolean; adBlocking: boolean; privateDirect: boolean }; transport: { wsPath: string } }
interface AppSettings { servers: ServerSettings[] }
interface TrafficPoint { t: number; bytesIn: number; bytesOut: number }

type UserTab = "status" | "plans" | "config" | "settings";
type AdminTab = "users" | "servers" | "metrics" | "add";
type InstallStatus = "idle" | "running" | "done" | "error";
interface StepState { step: string; status: "pending" | "running" | "done" | "error"; message?: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const tg = () => window.Telegram?.WebApp;
const isTg = () => !!window.Telegram?.WebApp?.initData;

function fmtBytes(b: number, d = 1) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(d)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(d)} MB`;
  return `${(b / 1024 ** 3).toFixed(d)} GB`;
}
function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м ${s % 60}с`;
}
function fmtDate(s: string) { return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }

// ─── Design ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0f172a", surface: "#1e293b", surfaceHigh: "#263349",
  border: "#334155", text: "#e2e8f0", muted: "#94a3b8", faint: "#475569",
  accent: "#3b82f6", accentDim: "#1d4ed8",
  green: "#22c55e", greenDim: "#052e16", greenBorder: "#166534",
  red: "#ef4444", redDim: "#450a0a", redBorder: "#7f1d1d",
  yellow: "#eab308", yellowDim: "#422006",
  purple: "#a855f7",
};

// ─── Primitives ──────────────────────────────────────────────────────────────
function CopyBtn({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  const handle = async () => {
    await navigator.clipboard.writeText(text);
    tg()?.HapticFeedback.notificationOccurred("success");
    setOk(true); setTimeout(() => setOk(false), 2000);
  };
  return (
    <button onClick={handle} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: ok ? C.green : C.accent, color: "#fff", transition: "background .15s", whiteSpace: "nowrap" }}>
      {ok ? "✓ Скопировано" : label}
    </button>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div onClick={() => !disabled && onChange(!checked)}
      style={{ width: 44, height: 26, borderRadius: 13, background: checked ? C.green : C.border, position: "relative", cursor: disabled ? "not-allowed" : "pointer", transition: "background .2s", flexShrink: 0, opacity: disabled ? .5 : 1 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: checked ? 21 : 3, transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.4)" }} />
    </div>
  );
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 16, height: 16, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin .7s linear infinite" }} />;
}

function Badge({ children, color = C.accent }: { children: React.ReactNode; color?: string }) {
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: color + "22", color, border: `1px solid ${color}44` }}>{children}</span>;
}

// ─── Bottom nav bar ───────────────────────────────────────────────────────────
function BottomNav<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; icon: string; label: string; badge?: number }[];
  active: T; onChange: (t: string) => void;
}) {
  return (
    <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => { onChange(t.key); tg()?.HapticFeedback.impactOccurred("light"); }}
          style={{ flex: 1, padding: "10px 4px 8px", border: "none", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, position: "relative" }}>
          <span style={{ fontSize: 22, lineHeight: 1, filter: active === t.key ? "none" : "grayscale(1) opacity(.5)" }}>{t.icon}</span>
          <span style={{ fontSize: 10, color: active === t.key ? C.accent : C.faint, fontWeight: active === t.key ? 700 : 400 }}>{t.label}</span>
          {t.badge != null && t.badge > 0 && (
            <span style={{ position: "absolute", top: 6, right: "calc(50% - 18px)", background: C.red, color: "#fff", borderRadius: 8, fontSize: 9, padding: "1px 4px", fontWeight: 700 }}>{t.badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

// ─── API helper ───────────────────────────────────────────────────────────────
function makeApi(token: string | null) {
  return async function api<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts?.headers ?? {}) },
    });
    return res.json() as Promise<T>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER APP
// ═══════════════════════════════════════════════════════════════════════════════

function UserApp({ user, token, onLogout }: { user: AuthUser; token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<UserTab>("status");
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [proxyIp, setProxyIp] = useState<string | null>(null);
  const api = makeApi(token);

  const loadMe = useCallback(async () => {
    const r = await api<{ ok: boolean; subscription: Subscription | null; usage: Usage | null }>("/user/me");
    if (r.ok) { setSub(r.subscription); setUsage(r.usage); }
  }, [token]);

  useEffect(() => {
    loadMe();
    api<{ ok: boolean; plans: PlanDef[] }>("/user/plans").then(r => { if (r.ok) setPlans(r.plans); });
    fetch("https://api.ipify.org?format=json").then(r => r.json()).then((d: { ip: string }) => setMyIp(d.ip)).catch(() => {});
  }, []);

  useEffect(() => {
    if (sub?.serverHost) setProxyIp(sub.serverHost);
  }, [sub]);

  const tabs: { key: UserTab; icon: string; label: string }[] = [
    { key: "status", icon: "🏠", label: "Статус" },
    { key: "plans", icon: "📦", label: "Тарифы" },
    { key: "config", icon: "🔑", label: "Конфиг" },
    { key: "settings", icon: "⚙️", label: "Настройки" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, paddingBottom: 80 }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 14px" }}>
        {tab === "status" && <UserStatusTab user={user} sub={sub} usage={usage} myIp={myIp} proxyIp={proxyIp} onGoPlans={() => setTab("plans")} />}
        {tab === "plans" && <UserPlansTab plans={plans} currentSub={sub} token={token} onSubscribed={() => { loadMe(); setTab("config"); }} />}
        {tab === "config" && <UserConfigTab sub={sub} onGoPlans={() => setTab("plans")} />}
        {tab === "settings" && <UserSettingsTab user={user} sub={sub} token={token} onSelfHosted={() => { loadMe(); setTab("config"); }} onLogout={onLogout} />}
      </div>
      <BottomNav tabs={tabs} active={tab} onChange={(t) => setTab(t as UserTab)} />
    </div>
  );
}

// ── Status tab ────────────────────────────────────────────────────────────────
function UserStatusTab({ user, sub, usage, myIp, proxyIp, onGoPlans }: {
  user: AuthUser; sub: Subscription | null; usage: Usage | null;
  myIp: string | null; proxyIp: string | null; onGoPlans: () => void;
}) {
  const plan = sub?.plan;
  const totalBytes = (usage?.bytesUp ?? 0) + (usage?.bytesDown ?? 0);
  const limitBytes = plan?.monthlyGb ? plan.monthlyGb * 1024 ** 3 : null;
  const pct = limitBytes ? Math.min(100, Math.round(totalBytes / limitBytes * 100)) : null;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>
          Привет, {user.firstName}! 👋
        </h2>
        <p style={{ fontSize: 12, color: C.faint, margin: 0 }}>@{user.username ?? "—"} · ID {user.telegramId}</p>
      </div>

      {/* VPN status card */}
      <div style={{ background: C.surface, borderRadius: 16, padding: 18, border: `1px solid ${sub ? C.greenBorder : C.border}`, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: sub?.active ? C.green : C.faint, boxShadow: sub?.active ? `0 0 8px ${C.green}` : "none" }} />
          <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{sub?.active ? "VPN Активен" : "VPN не настроен"}</span>
          {plan && <Badge color={C.purple}>{plan.emoji} {plan.name}</Badge>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <IpCard label="Ваш текущий IP" ip={myIp} note="Видят сайты без VPN" />
          <IpCard label="IP через VPN" ip={proxyIp} note="Будет виден при подключении" highlight />
        </div>

        {sub?.expiresAt && (
          <div style={{ marginTop: 12, fontSize: 12, color: C.faint }}>
            Тариф активен до <span style={{ color: C.text, fontWeight: 600 }}>{fmtDate(sub.expiresAt)}</span>
          </div>
        )}
      </div>

      {/* Traffic */}
      {sub && (
        <div style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Трафик этого месяца</div>
          {pct !== null ? (
            <>
              <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct > 90 ? C.red : pct > 70 ? C.yellow : C.green, transition: "width .3s", borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: C.text, fontWeight: 600 }}>{fmtBytes(totalBytes)}</span>
                <span style={{ color: C.faint }}>{fmtBytes(limitBytes!)} · {pct}%</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>♾️ Безлимитный трафик</div>
          )}
          {usage?.resetAt && <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Сброс {fmtDate(usage.resetAt)}</div>}
          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12, color: C.faint }}>
            <span>↑ {fmtBytes(usage?.bytesUp ?? 0)}</span>
            <span>↓ {fmtBytes(usage?.bytesDown ?? 0)}</span>
          </div>
        </div>
      )}

      {!sub && (
        <div style={{ background: C.surface, borderRadius: 14, padding: 20, textAlign: "center", border: `1px dashed ${C.border}` }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <div style={{ fontWeight: 600, color: C.text, marginBottom: 6 }}>Нет активного тарифа</div>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 14 }}>Выберите тариф чтобы начать пользоваться VPN</div>
          <button onClick={onGoPlans} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            Выбрать тариф →
          </button>
        </div>
      )}
    </div>
  );
}

function IpCard({ label, ip, note, highlight }: { label: string; ip: string | null; note: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? C.greenDim : "#0f172a", borderRadius: 10, padding: "10px 12px", border: `1px solid ${highlight ? C.greenBorder : C.border}` }}>
      <div style={{ fontSize: 10, color: C.faint, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? C.green : C.text, fontFamily: "monospace" }}>
        {ip ?? "—"}
      </div>
      <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{note}</div>
    </div>
  );
}

// ── Plans tab ─────────────────────────────────────────────────────────────────
function UserPlansTab({ plans, currentSub, token, onSubscribed }: {
  plans: PlanDef[]; currentSub: Subscription | null;
  token: string; onSubscribed: () => void;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const api = makeApi(token);

  const handleBuy = async (plan: PlanDef) => {
    if (plan.priceStars === 0) return;
    setBuying(plan.id);
    setErr(null);
    try {
      const tgUser = tg()?.initDataUnsafe.user;
      if (tgUser && isTg()) {
        const r = await api<{ ok: boolean; error?: string }>("/bot/invoice", {
          method: "POST",
          body: JSON.stringify({ chatId: tgUser.id, planId: plan.id, months: 1 }),
        });
        if (!r.ok) setErr(r.error ?? "Ошибка при создании счёта");
      } else {
        // Dev mode: subscribe directly
        const r = await api<{ ok: boolean; error?: string }>("/user/subscribe", {
          method: "POST",
          body: JSON.stringify({ planId: plan.id, months: 1 }),
        });
        if (r.ok) onSubscribed();
        else setErr(r.error ?? "Ошибка");
      }
    } catch (e) {
      setErr("Ошибка сети");
    } finally {
      setBuying(null);
    }
  };

  const handleSelfHosted = async () => {
    setBuying("self_hosted");
    const r = await api<{ ok: boolean; error?: string }>("/user/subscribe", {
      method: "POST",
      body: JSON.stringify({ planId: "self_hosted", months: 1 }),
    });
    setBuying(null);
    if (r.ok) onSubscribed();
    else setErr(r.error ?? "Ошибка");
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>Тарифы</h2>
      <p style={{ fontSize: 12, color: C.faint, margin: "0 0 18px" }}>Оплата через Telegram Stars ⭐</p>
      {err && <div style={{ background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: 10, color: "#fca5a5", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {plans.filter(p => p.id !== "self_hosted").map(plan => {
        const isCurrent = currentSub?.planId === plan.id && currentSub.active;
        return (
          <div key={plan.id} style={{
            background: isCurrent ? C.greenDim : C.surface,
            borderRadius: 14, padding: 16,
            border: `1px solid ${isCurrent ? C.greenBorder : C.border}`,
            marginBottom: 10,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{plan.emoji} {plan.name}</div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{plan.description}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 18, color: C.text }}>{plan.priceStars} ⭐</div>
                <div style={{ fontSize: 10, color: C.faint }}>в месяц</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <Badge color={C.accent}>{plan.monthlyGb ? `${plan.monthlyGb} GB` : "∞ трафик"}</Badge>
              <Badge color={C.purple}>{plan.devices} уст.</Badge>
              <Badge color={C.green}>{plan.speedMbps ? `${plan.speedMbps} Mbps` : "без лимита"}</Badge>
            </div>
            {isCurrent ? (
              <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>✓ Текущий тариф</div>
            ) : (
              <button onClick={() => handleBuy(plan)} disabled={buying === plan.id}
                style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 9, padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: buying === plan.id ? .6 : 1 }}>
                {buying === plan.id ? "Открываем…" : `Купить за ${plan.priceStars} ⭐`}
              </button>
            )}
          </div>
        );
      })}

      <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
      <p style={{ fontSize: 12, color: C.faint, textAlign: "center", margin: "0 0 12px" }}>или установите на свой сервер</p>

      <div style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 4 }}>🖥️ Self-Hosted</div>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 12 }}>Свой VPS — данные только у вас. Бесплатно, но нужен сервер.</div>
        <button onClick={handleSelfHosted} disabled={buying === "self_hosted"}
          style={{ width: "100%", background: "transparent", color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 9, padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          {buying === "self_hosted" ? "…" : "Выбрать Self-Hosted →"}
        </button>
      </div>
    </div>
  );
}

// ── Config tab ────────────────────────────────────────────────────────────────
function UserConfigTab({ sub, onGoPlans }: { sub: Subscription | null; onGoPlans: () => void }) {
  if (!sub?.active) return (
    <div style={{ textAlign: "center", paddingTop: 40 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
      <div style={{ fontWeight: 600, color: C.text, marginBottom: 8 }}>Нет активного конфига</div>
      <button onClick={onGoPlans} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontWeight: 700, cursor: "pointer" }}>Выбрать тариф</button>
    </div>
  );

  const apps = [
    { name: "V2RayNG", platform: "Android", icon: "🤖", url: "https://play.google.com/store/apps/details?id=com.v2ray.ang" },
    { name: "Streisand", platform: "iOS", icon: "🍎", url: "https://apps.apple.com/app/streisand/id6450534064" },
    { name: "Nekoray", platform: "Windows/Linux", icon: "💻", url: "https://github.com/MatsuriDayo/nekoray/releases" },
    { name: "Hiddify", platform: "Все платформы", icon: "🌐", url: "https://hiddify.com/" },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Мой конфиг</h2>

      <div style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14, textAlign: "center" }}>
        <div style={{ background: "#fff", padding: 12, borderRadius: 12, display: "inline-block", marginBottom: 12 }}>
          <QRCodeSVG value={sub.vlessLink} size={180} />
        </div>
        <div style={{ fontSize: 12, color: C.faint }}>Сканируйте QR в приложении V2RayNG или другом клиенте</div>
      </div>

      <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Параметры подключения</div>
        {[
          { label: "Сервер", val: sub.serverHost },
          { label: "Порт", val: "443" },
          { label: "Протокол", val: "VLESS + WS + TLS" },
          { label: "Путь", val: sub.wsPath },
          { label: "IP назначения", val: sub.serverHost },
        ].map(({ label, val }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
            <span style={{ color: C.faint }}>{label}</span>
            <span style={{ color: C.text, fontFamily: "monospace", fontWeight: 500 }}>{val}</span>
          </div>
        ))}
      </div>

      <CopyBtn text={sub.vlessLink} label="📋 Копировать ссылку" />

      <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}`, marginTop: 14 }}>
        <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>Клиентские приложения</div>
        {apps.map(a => (
          <a key={a.name} href={a.url} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none" }}>
            <span style={{ fontSize: 20 }}>{a.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{a.name}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{a.platform}</div>
            </div>
            <span style={{ color: C.faint, fontSize: 14 }}>→</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────
const INSTALL_STEPS_LABELS: Record<string, string> = {
  "os-check": "Проверка ОС", "install-deps": "Зависимости",
  "download-xray": "Скачивание xray", "configure-xray": "Конфигурация",
  "setup-systemd": "Systemd-сервис", "configure-nginx": "Nginx", "verify": "Проверка",
};

function UserSettingsTab({ user, sub, token, onSelfHosted, onLogout }: {
  user: AuthUser; sub: Subscription | null; token: string;
  onSelfHosted: () => void; onLogout: () => void;
}) {
  const [showInstall, setShowInstall] = useState(false);
  const api = makeApi(token);

  if (showInstall) return (
    <SshInstaller
      onDone={async (result) => {
        const r = await api<{ ok: boolean }>("/user/self-hosted", {
          method: "POST",
          body: JSON.stringify({ host: result.host, wsPath: result.wsPath, uuid: result.uuid }),
        });
        if (r.ok) { onSelfHosted(); setShowInstall(false); }
      }}
      onBack={() => setShowInstall(false)}
    />
  );

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 18px" }}>Настройки</h2>

      <div style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.surfaceHigh, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{user.firstName}</div>
            <div style={{ fontSize: 12, color: C.faint }}>@{user.username ?? "—"} · {user.telegramId}</div>
            {sub && <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>{sub.plan?.emoji} {sub.plan?.name ?? sub.planId}</div>}
          </div>
        </div>
      </div>

      <div style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 4 }}>🖥️ Self-Hosted сервер</div>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 14, lineHeight: 1.5 }}>
          Установите VPN на свой VPS — ваши данные не проходят через наши серверы.
          Поддержка Ubuntu, Debian, CentOS.
        </div>
        <button onClick={() => setShowInstall(true)}
          style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
          Установить на свой VPS
        </button>
      </div>

      <div style={{ background: C.redDim, borderRadius: 14, padding: 16, border: `1px solid ${C.redBorder}` }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#fca5a5", marginBottom: 10 }}>Опасная зона</div>
        <button onClick={onLogout}
          style={{ background: "transparent", color: C.red, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}

// ─── SSH Installer (shared) ───────────────────────────────────────────────────
function SshInstaller({ onDone, onBack }: {
  onDone: (r: { host: string; wsPath: string; uuid: string }) => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState({ host: "", port: "22", username: "root", password: "", privateKey: "", name: "" });
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [status, setStatus] = useState<InstallStatus>("idle");
  const [steps, setSteps] = useState<StepState[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const allKeys = Object.keys(INSTALL_STEPS_LABELS);

  const updateStep = (step: string, s: StepState["status"], message?: string) => {
    setSteps(prev => {
      const idx = prev.findIndex(x => x.step === step);
      if (idx >= 0) { const n = [...prev]; n[idx] = { step, status: s, message }; return n; }
      return [...prev, { step, status: s, message }];
    });
  };

  const run = async () => {
    setStatus("running"); setErrorMsg(null);
    setSteps(allKeys.map(k => ({ step: k, status: "pending" })));
    try {
      const body = { host: form.host, port: Number(form.port), username: form.username, name: form.name, ...(authMode === "password" ? { password: form.password } : { privateKey: form.privateKey }) };
      const res = await fetch("/api/servers/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const line of buf.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6)) as { type: string; step?: string; status?: StepState["status"]; message?: string; uuid?: string; wsPath?: string };
          if (evt.type === "step" && evt.step) updateStep(evt.step, evt.status ?? "running", evt.message);
          if (evt.type === "done") { setStatus("done"); onDone({ host: form.host, wsPath: evt.wsPath!, uuid: evt.uuid! }); return; }
          if (evt.type === "error") { setStatus("error"); setErrorMsg(evt.message ?? "Ошибка"); return; }
        }
        buf = buf.split("\n").pop() ?? "";
      }
    } catch (e) { setStatus("error"); setErrorMsg("Ошибка сети"); }
  };

  return (
    <div>
      <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, marginBottom: 14, padding: 0 }}>← Назад</button>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>Установка на VPS</h2>
      <p style={{ fontSize: 12, color: C.faint, margin: "0 0 18px" }}>xray установится автоматически через SSH</p>

      {status === "idle" || status === "error" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {errorMsg && <div style={{ background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: 10, color: "#fca5a5", fontSize: 13 }}>❌ {errorMsg}</div>}
          {[
            { key: "name", label: "Название", placeholder: "Frankfurt VPS" },
            { key: "host", label: "IP / домен *", placeholder: "1.2.3.4" },
            { key: "port", label: "SSH порт", placeholder: "22" },
            { key: "username", label: "Пользователь", placeholder: "root" },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>{label}</label>
              <input value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                style={{ width: "100%", background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, boxSizing: "border-box" }} />
            </div>
          ))}
          <div style={{ display: "flex", background: C.border, borderRadius: 8, padding: 2 }}>
            {(["password", "key"] as const).map(m => (
              <button key={m} onClick={() => setAuthMode(m)}
                style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: "none", cursor: "pointer", background: authMode === m ? C.surface : "transparent", color: authMode === m ? C.text : C.faint, fontWeight: authMode === m ? 600 : 400, fontSize: 12 }}>
                {m === "password" ? "🔑 Пароль" : "📄 SSH ключ"}
              </button>
            ))}
          </div>
          {authMode === "password"
            ? <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Пароль"
                style={{ background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, boxSizing: "border-box", width: "100%" }} />
            : <textarea value={form.privateKey} onChange={e => setForm(f => ({ ...f, privateKey: e.target.value }))} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" rows={4}
                style={{ background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 11, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box", width: "100%" }} />
          }
          <button onClick={run} disabled={!form.host || !form.username}
            style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            Установить →
          </button>
          <p style={{ fontSize: 10, color: C.faint, textAlign: "center", margin: 0 }}>Пароль/ключ не сохраняется после установки</p>
        </div>
      ) : (
        <div>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 14 }}>⏳ Установка на {form.host}…</p>
          {allKeys.map(key => {
            const s = steps.find(x => x.step === key);
            const st = s?.status ?? "pending";
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ width: 20, textAlign: "center" }}>
                  {st === "pending" ? "○" : st === "running" ? <Spinner /> : st === "done" ? "✅" : "❌"}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: st === "done" ? C.green : st === "error" ? C.red : st === "running" ? C.text : C.faint, fontWeight: st === "running" ? 600 : 400 }}>
                    {INSTALL_STEPS_LABELS[key]}
                  </div>
                  {s?.message && <div style={{ fontSize: 11, color: C.faint }}>{s.message}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function AdminPanel({ token }: { token: string }) {
  const [tab, setTab] = useState<AdminTab>("servers");
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<VlessInfo | null>(null);
  const api = makeApi(token);

  const reload = useCallback(() => {
    Promise.all([
      api<MetricsResponse>("/metrics"),
      api<AppSettings>("/settings"),
      api<VlessInfo>("/vless-info"),
    ]).then(([m, s, i]) => { setMetrics(m); setSettings(s); setInfo(i); }).catch(() => {});
  }, [token]);

  useEffect(() => { reload(); const t = setInterval(reload, 6000); return () => clearInterval(t); }, [reload]);

  const tabs: { key: AdminTab; icon: string; label: string; badge?: number }[] = [
    { key: "servers", icon: "🖥️", label: "Серверы" },
    { key: "metrics", icon: "📊", label: "Метрики", badge: metrics?.users.filter(u => u.limitExceeded).length },
    { key: "users", icon: "👥", label: "Юзеры" },
    { key: "add", icon: "➕", label: "Добавить" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, paddingBottom: 80 }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Admin Panel</div>
            <div style={{ fontSize: 11, color: C.faint }}>{info?.host ?? "—"}</div>
          </div>
          <Badge color={C.red} children="ADMIN" />
        </div>

        {tab === "servers" && settings && (
          <AdminServersTab settings={settings} token={token} onUpdated={(s) => setSettings(s)} />
        )}
        {tab === "metrics" && <AdminMetricsTab metrics={metrics} info={info} />}
        {tab === "users" && <AdminUsersTab info={info} metrics={metrics} token={token} onReload={reload} />}
        {tab === "add" && <AdminAddTab onDone={() => { setTab("servers"); reload(); }} />}
      </div>
      <BottomNav tabs={tabs} active={tab} onChange={(t) => setTab(t as AdminTab)} />
    </div>
  );
}

function AdminServersTab({ settings, token, onUpdated }: { settings: AppSettings; token: string; onUpdated: (s: AppSettings) => void }) {
  const api = makeApi(token);
  const [saving, setSaving] = useState<string | null>(null);

  const patchServer = async (id: string, changes: Partial<ServerSettings>) => {
    setSaving(Object.keys(changes.routing ?? changes)[0] ?? id);
    const r = await api<{ ok: boolean; server: ServerSettings }>(`/settings/servers/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
    setSaving(null);
    if (r.ok) onUpdated({ ...settings, servers: settings.servers.map(s => s.id === id ? r.server : s) });
  };

  return (
    <div>
      {settings.servers.map(srv => (
        <div key={srv.id} style={{ background: C.surface, borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: srv.enabled ? C.green : C.faint }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{srv.name}</span>
            <span style={{ fontSize: 11, color: C.faint, marginLeft: "auto" }}>
              <code style={{ color: C.muted }}>{srv.transport.wsPath}</code>
            </span>
          </div>
          {[
            { key: "ruDirect" as const, icon: "🇷🇺", title: "RU напрямую" },
            { key: "adBlocking" as const, icon: "🚫", title: "Блокировка рекламы" },
            { key: "privateDirect" as const, icon: "🏠", title: "Локальная сеть напрямую" },
          ].map(({ key, icon, title }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <span>{icon}</span>
              <span style={{ flex: 1, fontSize: 13, color: C.text }}>{title}</span>
              {saving === key && <Spinner />}
              <Toggle checked={srv.routing[key]} disabled={saving === key} onChange={v => patchServer(srv.id, { routing: { ...srv.routing, [key]: v } })} />
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 10 }}>
            <span>⚡</span>
            <span style={{ flex: 1, fontSize: 13, color: C.text }}>Сервер включён</span>
            {saving === "enabled" && <Spinner />}
            <Toggle checked={srv.enabled} disabled={saving === "enabled"} onChange={v => patchServer(srv.id, { enabled: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminMetricsTab({ metrics, info }: { metrics: MetricsResponse | null; info: VlessInfo | null }) {
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  const prev = useRef<{ bytesIn: number; bytesOut: number } | null>(null);
  useEffect(() => {
    if (!metrics) return;
    const { bytesIn, bytesOut } = metrics.server;
    if (prev.current) setHistory(h => [...h.slice(-29), { t: Date.now(), bytesIn: bytesIn - prev.current!.bytesIn, bytesOut: bytesOut - prev.current!.bytesOut }]);
    prev.current = { bytesIn, bytesOut };
  }, [metrics]);

  if (!metrics) return <div style={{ textAlign: "center", color: C.faint, paddingTop: 40 }}>⏳</div>;
  const s = metrics.server;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          { l: "Аптайм", v: fmtUptime(s.uptimeSeconds) },
          { l: "Соединений", v: String(s.totalConnections), sub: `${s.activeConnections} активных` },
          { l: "↓ Получено", v: fmtBytes(s.bytesIn) },
          { l: "↑ Отправлено", v: fmtBytes(s.bytesOut) },
          { l: "RAM", v: `${s.memUsedPct}%`, sub: `${fmtBytes(s.memTotalBytes - s.memFreeBytes)} / ${fmtBytes(s.memTotalBytes)}` },
          { l: "xray RAM", v: s.xrayAllocBytes != null ? fmtBytes(s.xrayAllocBytes) : "—" },
        ].map(({ l, v, sub }) => (
          <div key={l} style={{ background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{v}</div>
            {sub && <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>
      {history.length > 1 && (
        <div style={{ background: C.surface, borderRadius: 12, padding: "12px 14px", border: `1px solid ${C.border}`, marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Трафик</div>
          <ResponsiveContainer width="100%" height={70}>
            <AreaChart data={history} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={.4} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                <linearGradient id="go" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={.4} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              </defs>
              <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} formatter={(v: number, n: string) => [fmtBytes(v), n === "bytesIn" ? "↓ Вход" : "↑ Выход"]} labelFormatter={() => ""} />
              <Area type="monotone" dataKey="bytesIn" stroke="#3b82f6" fill="url(#gi)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="bytesOut" stroke="#22c55e" fill="url(#go)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em" }}>По пользователям (xray)</div>
        {metrics.users.map(u => (
          <div key={u.uuid} style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: u.enabled ? (u.limitExceeded ? C.red : C.green) : C.faint }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{u.label}</div>
              <div style={{ fontSize: 11, color: C.faint }}>↑ {fmtBytes(u.bytesUp)} · ↓ {fmtBytes(u.bytesDown)}</div>
            </div>
            {u.limitExceeded && <Badge color={C.red}>лимит</Badge>}
            {!u.enabled && <Badge color={C.faint}>откл</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminUsersTab({ info, metrics, token, onReload }: { info: VlessInfo | null; metrics: MetricsResponse | null; token: string; onReload: () => void }) {
  const api = makeApi(token);
  const [saving, setSaving] = useState<string | null>(null);

  const toggleUser = async (uuid: string, enabled: boolean) => {
    setSaving(uuid);
    await api(`/metrics/users/${uuid}/limits`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    setSaving(null);
    onReload();
  };

  return (
    <div>
      {info?.users.map(u => {
        const m = metrics?.users.find(x => x.uuid === u.uuid);
        return (
          <div key={u.uuid} style={{ background: C.surface, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: m?.enabled !== false ? C.green : C.faint }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{u.label}</div>
                <div style={{ fontSize: 11, color: C.faint, fontFamily: "monospace" }}>{u.uuid.slice(0, 20)}…</div>
              </div>
              {saving === u.uuid ? <Spinner /> : <Toggle checked={m?.enabled !== false} onChange={v => toggleUser(u.uuid, v)} />}
            </div>
            {m && (
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: C.faint }}>
                <span>↑ {fmtBytes(m.bytesUp)}</span>
                <span>↓ {fmtBytes(m.bytesDown)}</span>
                {m.limitExceeded && <span style={{ color: C.red }}>⚠ лимит</span>}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <CopyBtn text={u.vlessLink} label="Копировать ссылку" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminAddTab({ onDone }: { onDone: () => void }) {
  return <SshInstaller onDone={onDone} onBack={onDone} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

function AuthScreen({ onAuth }: { onAuth: (token: string, user: AuthUser) => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const tryAuth = async () => {
      try {
        const webApp = tg();
        if (webApp?.initData) {
          webApp.ready(); webApp.expand();
          const r = await fetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: webApp.initData }),
          }).then(x => x.json()) as { ok: boolean; token: string; user: AuthUser; error?: string };
          if (r.ok) { onAuth(r.token, r.user); return; }
          setErr(r.error ?? "Ошибка авторизации");
        } else {
          // Dev mode: use ADMIN_TELEGRAM_ID placeholder
          const r = await fetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ devTelegramId: 1 }),
          }).then(x => x.json()) as { ok: boolean; token: string; user: AuthUser };
          if (r.ok) { onAuth(r.token, r.user); return; }
          setErr("Dev auth failed");
        }
      } catch (e) { setErr("Нет соединения с сервером"); }
      finally { setLoading(false); }
    };
    tryAuth();
  }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <Spinner />
      <div style={{ fontSize: 13, color: C.faint }}>Авторизация…</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: "0 0 8px" }}>VLESS VPN</h1>
      {err && <div style={{ background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: 12, color: "#fca5a5", fontSize: 13, maxWidth: 300 }}>{err}</div>}
      <p style={{ fontSize: 12, color: C.faint, marginTop: 16 }}>Откройте приложение через Telegram бота</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("vless_token"));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const s = localStorage.getItem("vless_user");
    return s ? JSON.parse(s) as AuthUser : null;
  });

  const handleAuth = (t: string, u: AuthUser) => {
    localStorage.setItem("vless_token", t);
    localStorage.setItem("vless_user", JSON.stringify(u));
    setToken(t); setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem("vless_token");
    localStorage.removeItem("vless_user");
    setToken(null); setUser(null);
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes spin { to { transform: rotate(360deg) } }
        input, textarea, button { font-family: inherit; }
        input:focus, textarea:focus { outline: none; border-color: ${C.accent} !important; }
        a { color: inherit; }
      `}</style>

      {!token || !user
        ? <AuthScreen onAuth={handleAuth} />
        : user.isAdmin
          ? <AdminPanel token={token} />
          : <UserApp user={user} token={token} onLogout={handleLogout} />
      }
    </>
  );
}
