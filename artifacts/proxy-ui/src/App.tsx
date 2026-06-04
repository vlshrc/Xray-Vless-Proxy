import { useEffect, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserLink {
  label: string;
  uuid: string;
  vlessLink: string;
}

interface VlessInfo {
  host: string;
  port: number;
  path: string;
  users: UserLink[];
  features: { geoRouting: boolean; adBlocking: boolean; ruDirect: boolean };
  stats: {
    totalConnections: number;
    activeConnections: number;
    bytesIn: number;
    bytesOut: number;
    uptimeSeconds: number;
  };
}

interface ServerRouting {
  ruDirect: boolean;
  adBlocking: boolean;
  privateDirect: boolean;
}

interface ServerTransport {
  wsPath: string;
}

interface Server {
  id: string;
  name: string;
  enabled: boolean;
  routing: ServerRouting;
  transport: ServerTransport;
}

interface AppSettings {
  servers: Server[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

// ─── Design tokens ───────────────────────────────────────────────────────────

const C = {
  bg: "#0f172a",
  surface: "#1e293b",
  surfaceHover: "#263349",
  border: "#334155",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textFaint: "#475569",
  accent: "#3b82f6",
  accentHover: "#2563eb",
  green: "#22c55e",
  greenDim: "#052e16",
  greenBorder: "#166534",
  red: "#ef4444",
  redDim: "#450a0a",
  redBorder: "#7f1d1d",
};

// ─── Primitives ──────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      }}
      style={{
        padding: "5px 12px", borderRadius: "7px", fontSize: "12px",
        fontWeight: 600, border: "none", cursor: "pointer",
        background: ok ? C.green : C.accent, color: "#fff",
        transition: "background .15s", whiteSpace: "nowrap",
      }}
    >{ok ? "✓ Готово" : "Копировать"}</button>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: C.surface, borderRadius: "12px", padding: "14px 16px",
      border: `1px solid ${C.border}`, flex: 1, minWidth: "110px",
    }}>
      <div style={{ fontSize: "10px", color: C.textFaint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: C.text }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: C.textFaint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 42, height: 24, borderRadius: 12,
        background: checked ? C.green : C.border,
        position: "relative", cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .2s", flexShrink: 0, opacity: disabled ? .5 : 1,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: "50%", background: "#fff",
        position: "absolute", top: 3,
        left: checked ? 21 : 3,
        transition: "left .2s",
        boxShadow: "0 1px 3px rgba(0,0,0,.4)",
      }} />
    </div>
  );
}

// ─── Setting row ─────────────────────────────────────────────────────────────

function SettingRow({
  icon, title, desc, checked, onChange, disabled, saving,
}: {
  icon: string; title: string; desc: string;
  checked: boolean; onChange: (v: boolean) => void;
  disabled?: boolean; saving?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 0", borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>{desc}</div>
      </div>
      {saving && <span style={{ fontSize: 11, color: C.textMuted }}>…</span>}
      <Toggle checked={checked} onChange={onChange} disabled={disabled || saving} />
    </div>
  );
}

// ─── User card ────────────────────────────────────────────────────────────────

function UserCard({ user, host }: { user: UserLink; host: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      background: C.surface, borderRadius: 12, padding: "16px",
      border: `1px solid ${C.border}`, marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{user.label}</div>
          <div style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.uuid}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <CopyBtn text={user.vlessLink} />
          <button
            onClick={() => setOpen(v => !v)}
            style={{
              padding: "5px 12px", borderRadius: 7, fontSize: 12,
              fontWeight: 600, border: `1px solid ${C.border}`,
              cursor: "pointer", background: open ? C.border : "transparent",
              color: C.textMuted,
            }}
          >{open ? "↑" : "QR"}</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ background: "#fff", padding: 12, borderRadius: 10 }}>
            <QRCodeSVG value={user.vlessLink} size={180} />
          </div>
          <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>
            V2RayNG → + → Сканировать QR
          </p>
          <div style={{
            width: "100%", background: "#0a0f1e", borderRadius: 8, padding: 10,
            fontSize: 10, fontFamily: "monospace", color: "#7dd3fc",
            wordBreak: "break-all",
          }}>
            {user.vlessLink}
          </div>
          <div style={{ fontSize: 11, color: C.textFaint }}>
            <b style={{ color: C.textMuted }}>Хост:</b> {host} &nbsp;
            <b style={{ color: C.textMuted }}>Порт:</b> 443 &nbsp;
            <b style={{ color: C.textMuted }}>TLS:</b> on
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Server settings panel ────────────────────────────────────────────────────

function ServerPanel({
  server, onUpdated,
}: { server: Server; onUpdated: (s: Server) => void }) {
  const [saving, setSaving] = useState<string | null>(null);

  const patch = useCallback(
    async (changes: Partial<Server>) => {
      const key = Object.keys(changes.routing ?? changes)[0] ?? "?";
      setSaving(key);
      try {
        const res = await fetch(`/api/settings/servers/${server.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        const data = (await res.json()) as { ok: boolean; server: Server };
        if (data.ok) onUpdated(data.server);
      } finally {
        setSaving(null);
      }
    },
    [server.id, onUpdated],
  );

  const rows: {
    key: keyof ServerRouting; icon: string; title: string; desc: string;
  }[] = [
    {
      key: "ruDirect",
      icon: "🇷🇺",
      title: "Российские IP напрямую",
      desc: "geoip:ru — Яндекс, Госуслуги, банки без прокси",
    },
    {
      key: "adBlocking",
      icon: "🚫",
      title: "Блокировка рекламы",
      desc: "geosite:category-ads-all — рекламные домены в blackhole",
    },
    {
      key: "privateDirect",
      icon: "🏠",
      title: "Локальная сеть напрямую",
      desc: "geoip:private — 192.168.x, 10.x, 127.x без прокси",
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: server.enabled ? C.green : C.textFaint,
        }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{server.name}</span>
        <span style={{ fontSize: 11, color: C.textFaint, marginLeft: "auto" }}>
          WS: <code style={{ color: C.textMuted }}>{server.transport.wsPath}</code>
        </span>
      </div>

      <div style={{ marginTop: 4 }}>
        {rows.map(({ key, icon, title, desc }) => (
          <SettingRow
            key={key}
            icon={icon}
            title={title}
            desc={desc}
            checked={server.routing[key]}
            saving={saving === key}
            onChange={(v) => patch({ routing: { ...server.routing, [key]: v } })}
          />
        ))}
        <div style={{ padding: "14px 0", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>Сервер включён</div>
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>Принимает входящие подключения</div>
          </div>
          {saving === "enabled" && <span style={{ fontSize: 11, color: C.textMuted }}>…</span>}
          <Toggle
            checked={server.enabled}
            disabled={saving === "enabled"}
            onChange={(v) => patch({ enabled: v })}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Nav tabs ─────────────────────────────────────────────────────────────────

type Tab = "users" | "settings" | "stats";

function NavTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
        background: "transparent", fontWeight: active ? 700 : 500,
        fontSize: 13, color: active ? C.text : C.textFaint,
        borderBottom: `2px solid ${active ? C.accent : "transparent"}`,
        transition: "all .15s",
      }}
    >{label}</button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [info, setInfo] = useState<VlessInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      fetch("/api/vless-info").then(r => r.json() as Promise<VlessInfo>),
      fetch("/api/settings").then(r => r.json() as Promise<AppSettings>),
    ])
      .then(([i, s]) => { setInfo(i); setSettings(s); setError(null); })
      .catch(() => setError("Сервер недоступен. Перезапускается?"));
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 6000);
    return () => clearInterval(t);
  }, [reload]);

  const handleServerUpdated = useCallback((updated: Server) => {
    setSettings(s => s
      ? { ...s, servers: s.servers.map(sv => sv.id === updated.id ? updated : sv) }
      : s
    );
    setTimeout(reload, 1500);
  }, [reload]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 30, marginBottom: 4 }}>🔒</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>
            VLESS Proxy
          </h1>
          <div style={{ fontSize: 12, color: C.textFaint }}>
            {info ? info.host : "—"}
          </div>
        </div>

        {error && (
          <div style={{
            background: C.redDim, border: `1px solid ${C.redBorder}`,
            borderRadius: 10, padding: 12, color: "#fca5a5",
            textAlign: "center", marginBottom: 16, fontSize: 13,
          }}>{error}</div>
        )}

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 20,
        }}>
          <NavTab label="👤 Пользователи" active={tab === "users"} onClick={() => setTab("users")} />
          <NavTab label="⚙️ Настройки" active={tab === "settings"} onClick={() => setTab("settings")} />
          <NavTab label="📊 Статистика" active={tab === "stats"} onClick={() => setTab("stats")} />
        </div>

        {/* Users tab */}
        {tab === "users" && (
          <div>
            {info
              ? info.users.map(u => <UserCard key={u.uuid} user={u} host={info.host} />)
              : <Skeleton />}
          </div>
        )}

        {/* Settings tab */}
        {tab === "settings" && (
          <div>
            {settings ? (
              settings.servers.map(srv => (
                <div key={srv.id} style={{
                  background: C.surface, borderRadius: 14, padding: "16px 18px",
                  border: `1px solid ${C.border}`, marginBottom: 12,
                }}>
                  <ServerPanel server={srv} onUpdated={handleServerUpdated} />
                </div>
              ))
            ) : <Skeleton />}

            <div style={{
              marginTop: 16, padding: "12px 14px", background: C.surface,
              borderRadius: 10, border: `1px dashed ${C.border}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>＋</span>
              <div>
                <div style={{ fontSize: 13, color: C.textMuted, fontWeight: 600 }}>Добавить сервер</div>
                <div style={{ fontSize: 11, color: C.textFaint }}>SSH-установщик — скоро</div>
              </div>
            </div>
          </div>
        )}

        {/* Stats tab */}
        {tab === "stats" && info && (
          <div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard
                label="Подключений"
                value={String(info.stats.totalConnections)}
                sub={`${info.stats.activeConnections} активных`}
              />
              <StatCard label="↓ Получено" value={formatBytes(info.stats.bytesIn)} />
              <StatCard label="↑ Отправлено" value={formatBytes(info.stats.bytesOut)} />
              <StatCard label="Аптайм" value={formatUptime(info.stats.uptimeSeconds)} />
            </div>

            {/* Active features */}
            {settings && (
              <div style={{ background: C.surface, borderRadius: 12, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textFaint, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                  Активные правила
                </div>
                {settings.servers.map(srv => (
                  <div key={srv.id} style={{ fontSize: 12, lineHeight: 2 }}>
                    {srv.routing.ruDirect && <div>🇷🇺 Россия → прямой</div>}
                    {srv.routing.adBlocking && <div>🚫 Реклама → заблокировано</div>}
                    {srv.routing.privateDirect && <div>🏠 Локальная сеть → прямой</div>}
                    {!srv.routing.ruDirect && !srv.routing.adBlocking && !srv.routing.privateDirect && (
                      <div style={{ color: C.textFaint }}>Все правила отключены</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "stats" && !info && <Skeleton />}

        <p style={{ textAlign: "center", fontSize: 10, color: C.textFaint, marginTop: 24 }}>
          Обновляется каждые 6 сек
        </p>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ textAlign: "center", color: C.textFaint, paddingTop: 40 }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
      Загрузка...
    </div>
  );
}
