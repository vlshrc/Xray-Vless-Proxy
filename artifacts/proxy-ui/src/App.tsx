import { useEffect, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AreaChart, Area, Tooltip, ResponsiveContainer } from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserLink { label: string; uuid: string; vlessLink: string }
interface VlessInfo {
  host: string; port: number; path: string; users: UserLink[];
  features: { geoRouting: boolean; adBlocking: boolean; ruDirect: boolean };
  stats: { totalConnections: number; activeConnections: number; bytesIn: number; bytesOut: number; uptimeSeconds: number };
}
interface UserMetric {
  uuid: string; label: string; email: string; enabled: boolean;
  bytesUp: number; bytesDown: number;
  speedMbps: number | null; monthlyGbLimit: number | null;
  monthlyUsedBytes: number; limitExceeded: boolean; resetAt: string | null;
}
interface ServerMetric {
  host: string; uptimeSeconds: number; xrayUptime: number | null;
  activeConnections: number; totalConnections: number;
  bytesIn: number; bytesOut: number;
  memFreeBytes: number; memTotalBytes: number; memUsedPct: number;
  xrayAllocBytes: number | null;
}
interface MetricsResponse { server: ServerMetric; users: UserMetric[] }
interface ServerRouting { ruDirect: boolean; adBlocking: boolean; privateDirect: boolean }
interface Server { id: string; name: string; enabled: boolean; routing: ServerRouting; transport: { wsPath: string } }
interface AppSettings { servers: Server[] }

interface TrafficPoint { t: number; bytesIn: number; bytesOut: number }

type Tab = "users" | "servers" | "metrics" | "add";

// ─── Install steps ────────────────────────────────────────────────────────────
const INSTALL_STEPS: Record<string, string> = {
  "os-check": "Проверка ОС",
  "install-deps": "Установка зависимостей",
  "download-xray": "Скачивание xray-core",
  "configure-xray": "Настройка xray",
  "setup-systemd": "Systemd-сервис",
  "configure-nginx": "Настройка nginx",
  "verify": "Проверка",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtBytes(b: number, dec = 1) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(dec)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(dec)} MB`;
  return `${(b / 1024 ** 3).toFixed(dec)} GB`;
}
function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

// ─── Design ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0f172a", surface: "#1e293b", border: "#334155",
  text: "#e2e8f0", muted: "#94a3b8", faint: "#475569",
  accent: "#3b82f6", green: "#22c55e", greenDim: "#052e16", greenBorder: "#166534",
  red: "#ef4444", redDim: "#450a0a", redBorder: "#7f1d1d",
  yellow: "#eab308", yellowDim: "#422006",
};

// ─── Primitives ──────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); }}
      style={{ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: ok ? C.green : C.accent, color: "#fff", whiteSpace: "nowrap" }}>
      {ok ? "✓" : "Копировать"}
    </button>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div onClick={() => !disabled && onChange(!checked)}
      style={{ width: 42, height: 24, borderRadius: 12, background: checked ? C.green : C.border, position: "relative", cursor: disabled ? "not-allowed" : "pointer", transition: "background .2s", flexShrink: 0, opacity: disabled ? .5 : 1 }}>
      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: checked ? 21 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.4)" }} />
    </div>
  );
}

function NavTab({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: "10px 4px", border: "none", cursor: "pointer", background: "transparent", fontWeight: active ? 700 : 500, fontSize: 12, color: active ? C.text : C.muted, borderBottom: `2px solid ${active ? C.accent : "transparent"}`, position: "relative" }}>
      {label}
      {badge != null && badge > 0 && (
        <span style={{ marginLeft: 4, background: C.red, color: "#fff", borderRadius: 8, fontSize: 10, padding: "1px 5px" }}>{badge}</span>
      )}
    </button>
  );
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 14, height: 14, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

// ─── User card (users tab) ────────────────────────────────────────────────────
function UserCard({ user, host, metric, onLimitChange }: {
  user: UserLink; host: string; metric?: UserMetric;
  onLimitChange: (uuid: string, patch: { monthlyGbLimit?: number | null; speedMbps?: number | null; enabled?: boolean }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [gbLimit, setGbLimit] = useState(String(metric?.monthlyGbLimit ?? ""));
  const [speed, setSpeed] = useState(String(metric?.speedMbps ?? ""));
  const [saving, setSaving] = useState(false);

  const pct = metric?.monthlyGbLimit
    ? Math.min(100, Math.round(metric.monthlyUsedBytes / (metric.monthlyGbLimit * 1024 ** 3) * 100))
    : null;
  const exceeded = metric?.limitExceeded;

  return (
    <div style={{ background: C.surface, borderRadius: 12, padding: 16, border: `1px solid ${exceeded ? C.redBorder : C.border}`, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: metric?.enabled === false ? C.faint : exceeded ? C.red : C.green, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{user.label}</div>
          {metric && (
            <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>
              ↑ {fmtBytes(metric.bytesUp)} · ↓ {fmtBytes(metric.bytesDown)}
              {metric.monthlyGbLimit && <span style={{ color: exceeded ? C.red : C.muted }}> · {fmtBytes(metric.monthlyUsedBytes)}/{metric.monthlyGbLimit}GB</span>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {metric && (
            <Toggle checked={metric.enabled} onChange={async (v) => { await onLimitChange(user.uuid, { enabled: v }); }} />
          )}
          <CopyBtn text={user.vlessLink} />
          <button onClick={() => setOpen(v => !v)}
            style={{ padding: "5px 10px", borderRadius: 7, fontSize: 12, border: `1px solid ${C.border}`, cursor: "pointer", background: open ? C.border : "transparent", color: C.muted }}>
            {open ? "↑" : "QR"}
          </button>
        </div>
      </div>

      {pct !== null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: exceeded ? C.red : pct > 80 ? C.yellow : C.green, transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 10, color: C.faint, marginTop: 3, textAlign: "right" }}>{pct}% использовано · сброс {metric?.resetAt ? new Date(metric.resetAt).toLocaleDateString("ru") : "—"}</div>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ background: "#fff", padding: 10, borderRadius: 10 }}>
              <QRCodeSVG value={user.vlessLink} size={170} />
            </div>
            <div style={{ width: "100%", background: "#0a0f1e", borderRadius: 8, padding: 10, fontSize: 10, fontFamily: "monospace", color: "#7dd3fc", wordBreak: "break-all" }}>
              {user.vlessLink}
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Лимиты трафика</span>
              <button onClick={() => setEditing(e => !e)}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer" }}>
                {editing ? "Отмена" : "Изменить"}
              </button>
            </div>
            {!editing ? (
              <div style={{ fontSize: 12, color: C.faint, lineHeight: 2 }}>
                <div>📦 Лимит в месяц: <span style={{ color: C.text }}>{metric?.monthlyGbLimit ? `${metric.monthlyGbLimit} GB` : "без лимита"}</span></div>
                <div>⚡ Скорость: <span style={{ color: C.text }}>{metric?.speedMbps ? `${metric.speedMbps} Mbps` : "без лимита"}</span></div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 12, color: C.muted, width: 120 }}>Лимит (GB/мес):</label>
                  <input value={gbLimit} onChange={e => setGbLimit(e.target.value)} placeholder="∞"
                    style={{ flex: 1, background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", color: C.text, fontSize: 12 }} />
                  <button onClick={() => { setGbLimit(""); }}
                    style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer" }}>∞</button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 12, color: C.muted, width: 120 }}>Скорость (Mbps):</label>
                  <input value={speed} onChange={e => setSpeed(e.target.value)} placeholder="∞"
                    style={{ flex: 1, background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", color: C.text, fontSize: 12 }} />
                  <button onClick={() => setSpeed("")}
                    style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer" }}>∞</button>
                </div>
                <button
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    await onLimitChange(user.uuid, {
                      monthlyGbLimit: gbLimit ? Number(gbLimit) : null,
                      speedMbps: speed ? Number(speed) : null,
                    });
                    setSaving(false);
                    setEditing(false);
                  }}
                  style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 7, padding: "7px 0", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Server panel (settings tab) ─────────────────────────────────────────────
function ServerPanel({ server, onUpdated }: { server: Server; onUpdated: (s: Server) => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const patch = useCallback(async (changes: Partial<Server>) => {
    const key = Object.keys(changes.routing ?? changes)[0] ?? "?";
    setSaving(key);
    try {
      const res = await fetch(`/api/settings/servers/${server.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const data = (await res.json()) as { ok: boolean; server: Server };
      if (data.ok) onUpdated(data.server);
    } finally { setSaving(null); }
  }, [server.id, onUpdated]);

  const rows: { key: keyof ServerRouting; icon: string; title: string; desc: string }[] = [
    { key: "ruDirect", icon: "🇷🇺", title: "Российские IP напрямую", desc: "geoip:ru → direct" },
    { key: "adBlocking", icon: "🚫", title: "Блокировка рекламы", desc: "geosite:category-ads-all → blocked" },
    { key: "privateDirect", icon: "🏠", title: "Локальная сеть напрямую", desc: "geoip:private → direct" },
  ];

  return (
    <div style={{ background: C.surface, borderRadius: 12, padding: "14px 16px", border: `1px solid ${C.border}`, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: server.enabled ? C.green : C.faint }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{server.name}</span>
        <span style={{ fontSize: 11, color: C.faint, marginLeft: "auto" }}>
          WS: <code style={{ color: C.muted }}>{server.transport.wsPath}</code>
        </span>
      </div>
      {rows.map(({ key, icon, title, desc }) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{title}</div>
            <div style={{ fontSize: 11, color: C.faint }}>{desc}</div>
          </div>
          {saving === key && <Spinner />}
          <Toggle checked={server.routing[key]} disabled={saving === key} onChange={(v) => patch({ routing: { ...server.routing, [key]: v } })} />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 11 }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>Сервер включён</div>
          <div style={{ fontSize: 11, color: C.faint }}>Принимает входящие подключения</div>
        </div>
        {saving === "enabled" && <Spinner />}
        <Toggle checked={server.enabled} disabled={saving === "enabled"} onChange={(v) => patch({ enabled: v })} />
      </div>
    </div>
  );
}

// ─── Metrics tab ──────────────────────────────────────────────────────────────
function MetricsTab({ metrics }: { metrics: MetricsResponse | null }) {
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  const prevRef = useRef<{ bytesIn: number; bytesOut: number } | null>(null);

  useEffect(() => {
    if (!metrics) return;
    const { bytesIn, bytesOut } = metrics.server;
    const prev = prevRef.current;
    if (prev) {
      setHistory(h => [...h.slice(-29), { t: Date.now(), bytesIn: bytesIn - prev.bytesIn, bytesOut: bytesOut - prev.bytesOut }]);
    }
    prevRef.current = { bytesIn, bytesOut };
  }, [metrics]);

  if (!metrics) return <div style={{ textAlign: "center", color: C.faint, paddingTop: 40 }}>⏳ Загрузка…</div>;
  const s = metrics.server;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Аптайм", value: fmtUptime(s.uptimeSeconds) },
          { label: "Соединений", value: String(s.totalConnections), sub: `${s.activeConnections} активных` },
          { label: "↓ Получено", value: fmtBytes(s.bytesIn) },
          { label: "↑ Отправлено", value: fmtBytes(s.bytesOut) },
          { label: "RAM использование", value: `${s.memUsedPct}%`, sub: `${fmtBytes(s.memTotalBytes - s.memFreeBytes)} / ${fmtBytes(s.memTotalBytes)}` },
          { label: "xray память", value: s.xrayAllocBytes != null ? fmtBytes(s.xrayAllocBytes) : "—" },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{value}</div>
            {sub && <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {history.length > 1 && (
        <div style={{ background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Трафик (последние {history.length} интервалов)</div>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={history} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }}
                formatter={(v: number, name: string) => [fmtBytes(v), name === "bytesIn" ? "↓ Вход" : "↑ Выход"]}
                labelFormatter={() => ""}
              />
              <Area type="monotone" dataKey="bytesIn" stroke="#3b82f6" fill="url(#gIn)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="bytesOut" stroke="#22c55e" fill="url(#gOut)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11, color: C.faint }}>
            <span style={{ color: "#3b82f6" }}>■</span> Входящий
            <span style={{ color: "#22c55e" }}>■</span> Исходящий
          </div>
        </div>
      )}

      <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: ".06em" }}>
          По пользователям
        </div>
        {metrics.users.map(u => (
          <div key={u.uuid} style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: u.enabled ? (u.limitExceeded ? C.red : C.green) : C.faint, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{u.label}</div>
              <div style={{ fontSize: 11, color: C.faint }}>↑ {fmtBytes(u.bytesUp)} · ↓ {fmtBytes(u.bytesDown)}</div>
              {u.monthlyGbLimit && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: "hidden", width: "100%" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.round(u.monthlyUsedBytes / (u.monthlyGbLimit * 1024 ** 3) * 100))}%`, background: u.limitExceeded ? C.red : C.green }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>
                    {fmtBytes(u.monthlyUsedBytes)} / {u.monthlyGbLimit} GB {u.limitExceeded && <span style={{ color: C.red }}>· превышен</span>}
                  </div>
                </div>
              )}
            </div>
            {!u.enabled && <span style={{ fontSize: 10, color: C.faint, background: C.border, padding: "2px 7px", borderRadius: 5 }}>откл</span>}
            {u.limitExceeded && <span style={{ fontSize: 10, color: C.red, background: C.redDim, padding: "2px 7px", borderRadius: 5 }}>лимит</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Add server (SSH installer) ───────────────────────────────────────────────
type InstallStatus = "idle" | "running" | "done" | "error";
interface StepState { step: string; status: "pending" | "running" | "done" | "error"; message?: string }

function AddServerTab({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ host: "", port: "22", username: "root", password: "", privateKey: "", name: "" });
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [steps, setSteps] = useState<StepState[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ uuid: string; wsPath: string } | null>(null);

  const allStepKeys = Object.keys(INSTALL_STEPS);

  const updateStep = (step: string, status: StepState["status"], message?: string) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.step === step);
      if (idx >= 0) {
        const next = [...prev]; next[idx] = { step, status, message }; return next;
      }
      return [...prev, { step, status, message }];
    });
  };

  const handleInstall = async () => {
    setInstallStatus("running");
    setErrorMsg(null);
    setSteps(allStepKeys.map(k => ({ step: k, status: "pending" })));

    try {
      const body = { host: form.host, port: Number(form.port), username: form.username, name: form.name, ...(authMode === "password" ? { password: form.password } : { privateKey: form.privateKey }) };
      const res = await fetch("/api/servers/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6)) as { type: string; step?: string; status?: StepState["status"]; message?: string; uuid?: string; wsPath?: string };
          if (evt.type === "step" && evt.step) updateStep(evt.step, evt.status ?? "running", evt.message);
          if (evt.type === "done") { setInstallStatus("done"); setResult({ uuid: evt.uuid!, wsPath: evt.wsPath! }); }
          if (evt.type === "error") { setInstallStatus("error"); setErrorMsg(evt.message ?? "Неизвестная ошибка"); }
        }
      }
    } catch (e) {
      setInstallStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Ошибка сети");
    }
  };

  if (installStatus === "done" && result) return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
      <h2 style={{ color: C.text, margin: "0 0 8px" }}>Сервер установлен!</h2>
      <p style={{ color: C.faint, fontSize: 13 }}>{form.host}</p>
      <div style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.greenBorder}`, marginBottom: 16, textAlign: "left" }}>
        <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>UUID:</div>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#7dd3fc", wordBreak: "break-all" }}>{result.uuid}</div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8, marginBottom: 4 }}>WS путь:</div>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#7dd3fc" }}>{result.wsPath}</div>
      </div>
      <button onClick={onDone} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
        К серверам →
      </button>
    </div>
  );

  return (
    <div>
      <h2 style={{ color: C.text, fontSize: 16, margin: "0 0 4px" }}>Добавить сервер (SSH)</h2>
      <p style={{ color: C.faint, fontSize: 12, margin: "0 0 20px" }}>Введите SSH-данные — xray установится автоматически</p>

      {installStatus === "idle" || installStatus === "error" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {errorMsg && (
            <div style={{ background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: 10, color: "#fca5a5", fontSize: 13 }}>
              ❌ {errorMsg}
            </div>
          )}

          {[
            { key: "name", label: "Название сервера", placeholder: "Frankfurt VPS", type: "text" },
            { key: "host", label: "IP / домен *", placeholder: "1.2.3.4 или my.server.com", type: "text" },
            { key: "port", label: "SSH порт", placeholder: "22", type: "number" },
            { key: "username", label: "Пользователь", placeholder: "root", type: "text" },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>{label}</label>
              <input type={type} value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                style={{ width: "100%", background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, boxSizing: "border-box" }} />
            </div>
          ))}

          <div style={{ display: "flex", gap: 0, background: C.border, borderRadius: 8, padding: 2, marginTop: 4 }}>
            {(["password", "key"] as const).map(m => (
              <button key={m} onClick={() => setAuthMode(m)}
                style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: "none", cursor: "pointer", background: authMode === m ? C.surface : "transparent", color: authMode === m ? C.text : C.faint, fontWeight: authMode === m ? 600 : 400, fontSize: 12 }}>
                {m === "password" ? "🔑 Пароль" : "📄 SSH ключ"}
              </button>
            ))}
          </div>

          {authMode === "password" ? (
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Пароль *</label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••"
                style={{ width: "100%", background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, boxSizing: "border-box" }} />
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Приватный ключ (PEM) *</label>
              <textarea value={form.privateKey} onChange={e => setForm(f => ({ ...f, privateKey: e.target.value }))} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                rows={5}
                style={{ width: "100%", background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 11, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
            </div>
          )}

          <button onClick={handleInstall} disabled={!form.host || !form.username || (authMode === "password" ? !form.password : !form.privateKey)}
            style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "11px 0", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 6, opacity: (!form.host || !form.username) ? .5 : 1 }}>
            Установить →
          </button>

          <p style={{ fontSize: 10, color: C.faint, textAlign: "center", margin: "4px 0 0" }}>
            Пароль/ключ не сохраняется — используется только для установки
          </p>
        </div>
      ) : (
        <div>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>⏳ Установка на {form.host}…</p>
          {allStepKeys.map(key => {
            const s = steps.find(x => x.step === key);
            const status = s?.status ?? "pending";
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>
                  {status === "pending" ? "○" : status === "running" ? "⟳" : status === "done" ? "✅" : "❌"}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: status === "running" ? 700 : 400, color: status === "done" ? C.green : status === "error" ? C.red : status === "running" ? C.text : C.faint }}>
                    {INSTALL_STEPS[key]}
                  </div>
                  {s?.message && <div style={{ fontSize: 11, color: C.faint }}>{s.message}</div>}
                </div>
                {status === "running" && <Spinner />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [info, setInfo] = useState<VlessInfo | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      fetch("/api/vless-info").then(r => r.json() as Promise<VlessInfo>),
      fetch("/api/metrics").then(r => r.json() as Promise<MetricsResponse>),
      fetch("/api/settings").then(r => r.json() as Promise<AppSettings>),
    ]).then(([i, m, s]) => { setInfo(i); setMetrics(m); setSettings(s); setError(null); })
      .catch(() => setError("Сервер недоступен"));
  }, []);

  useEffect(() => { reload(); const t = setInterval(reload, 6000); return () => clearInterval(t); }, [reload]);

  const handleLimitChange = useCallback(async (uuid: string, patch: object) => {
    await fetch(`/api/metrics/users/${uuid}/limits`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    reload();
  }, [reload]);

  const handleServerUpdated = useCallback((updated: Server) => {
    setSettings(s => s ? { ...s, servers: s.servers.map(sv => sv.id === updated.id ? updated : sv) } : s);
    setTimeout(reload, 1500);
  }, [reload]);

  const exceededCount = metrics?.users.filter(u => u.limitExceeded).length ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, sans-serif" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } input,textarea { outline: none } input:focus,textarea:focus { border-color: ${C.accent} !important }`}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 14px" }}>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 26, marginBottom: 2 }}>🔒</div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: "0 0 2px" }}>VLESS Proxy</h1>
          <div style={{ fontSize: 11, color: C.faint }}>{info ? info.host : "—"}</div>
        </div>

        {error && <div style={{ background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: 10, color: "#fca5a5", textAlign: "center", marginBottom: 14, fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 18 }}>
          <NavTab label="👤 Юзеры" active={tab === "users"} onClick={() => setTab("users")} />
          <NavTab label="⚙️ Серверы" active={tab === "servers"} onClick={() => setTab("servers")} />
          <NavTab label="📊 Метрики" active={tab === "metrics"} onClick={() => setTab("metrics")} badge={exceededCount} />
          <NavTab label="＋ Добавить" active={tab === "add"} onClick={() => setTab("add")} />
        </div>

        {tab === "users" && (
          <div>
            {info && metrics
              ? info.users.map(u => (
                <UserCard key={u.uuid} user={u} host={info.host}
                  metric={metrics.users.find(m => m.uuid === u.uuid)}
                  onLimitChange={handleLimitChange} />
              ))
              : <div style={{ textAlign: "center", color: C.faint, paddingTop: 40 }}>⏳ Загрузка…</div>}
          </div>
        )}

        {tab === "servers" && (
          <div>
            {settings
              ? settings.servers.map(srv => <ServerPanel key={srv.id} server={srv} onUpdated={handleServerUpdated} />)
              : <div style={{ textAlign: "center", color: C.faint, paddingTop: 40 }}>⏳ Загрузка…</div>}
            <div onClick={() => setTab("add")}
              style={{ marginTop: 10, padding: "12px 14px", background: C.surface, borderRadius: 10, border: `1px dashed ${C.border}`, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <span style={{ fontSize: 18 }}>＋</span>
              <div>
                <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Добавить VPS через SSH</div>
                <div style={{ fontSize: 11, color: C.faint }}>Ubuntu / Debian / CentOS</div>
              </div>
            </div>
          </div>
        )}

        {tab === "metrics" && <MetricsTab metrics={metrics} />}

        {tab === "add" && <AddServerTab onDone={() => { setTab("servers"); reload(); }} />}

        <p style={{ textAlign: "center", fontSize: 10, color: "#1e293b", marginTop: 20 }}>обновляется каждые 6с</p>
      </div>
    </div>
  );
}
