import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

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
  features: {
    geoRouting: boolean;
    adBlocking: boolean;
    ruDirect: boolean;
  };
  stats: {
    totalConnections: number;
    activeConnections: number;
    bytesIn: number;
    bytesOut: number;
    uptimeSeconds: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        padding: "6px 14px", borderRadius: "8px", fontSize: "12px",
        fontWeight: 600, border: "none", cursor: "pointer",
        background: copied ? "#16a34a" : "#2563eb", color: "#fff",
        transition: "background 0.2s",
      }}
    >
      {copied ? "✓ Скопировано" : "Копировать"}
    </button>
  );
}

function UserCard({ user, host }: { user: UserLink; host: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      background: "#1e293b", borderRadius: "14px", padding: "20px",
      border: "1px solid #334155", marginBottom: "12px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? "16px" : 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "#f1f5f9" }}>{user.label}</div>
          <div style={{ fontSize: "12px", color: "#64748b", fontFamily: "monospace", marginTop: "2px" }}>
            {user.uuid.slice(0, 18)}…
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <CopyButton text={user.vlessLink} />
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              padding: "6px 14px", borderRadius: "8px", fontSize: "12px",
              fontWeight: 600, border: "1px solid #334155", cursor: "pointer",
              background: open ? "#334155" : "transparent", color: "#94a3b8",
            }}
          >
            {open ? "↑ Скрыть" : "QR →"}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <div style={{ background: "#fff", padding: "12px", borderRadius: "10px" }}>
            <QRCodeSVG value={user.vlessLink} size={180} />
          </div>
          <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
            V2RayNG → + → Сканировать QR
          </p>
          <div style={{ width: "100%", background: "#0f172a", borderRadius: "8px", padding: "10px", fontSize: "11px", fontFamily: "monospace", color: "#7dd3fc", wordBreak: "break-all" }}>
            {user.vlessLink}
          </div>
          <div style={{ width: "100%", fontSize: "12px", color: "#64748b", lineHeight: "2" }}>
            <b style={{ color: "#94a3b8" }}>Адрес:</b> {host} &nbsp;
            <b style={{ color: "#94a3b8" }}>Порт:</b> 443 &nbsp;
            <b style={{ color: "#94a3b8" }}>Путь:</b> /ws &nbsp;
            <b style={{ color: "#94a3b8" }}>TLS:</b> tls
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: "#1e293b", borderRadius: "12px", padding: "16px",
      border: "1px solid #334155", flex: 1, minWidth: "120px",
    }}>
      <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9" }}>{value}</div>
      {sub && <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function FeatureBadge({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      padding: "6px 12px", borderRadius: "8px",
      background: active ? "#052e16" : "#1e293b",
      border: `1px solid ${active ? "#166534" : "#334155"}`,
      fontSize: "12px", color: active ? "#86efac" : "#64748b",
    }}>
      <span>{icon}</span>
      <span>{label}</span>
      {active && <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>}
    </div>
  );
}

export default function App() {
  const [info, setInfo] = useState<VlessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/vless-info")
        .then((r) => r.json())
        .then((d: VlessInfo) => setInfo(d))
        .catch(() => setError("Не удалось загрузить конфиг. Сервер запускается?"));
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: "#0f172a", color: "#e2e8f0",
      padding: "24px", fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: "540px", margin: "0 auto" }}>

        {/* Заголовок */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ fontSize: "28px", marginBottom: "6px" }}>🔒</div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 4px" }}>
            Replit VLESS Proxy
          </h1>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
            {info ? `${info.host}` : "Загрузка..."}
          </p>
        </div>

        {error && (
          <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "12px", padding: "14px", color: "#fca5a5", textAlign: "center", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {info && (
          <>
            {/* Функции */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
              <FeatureBadge icon="🌍" label="Гео-роутинг" active={info.features.geoRouting} />
              <FeatureBadge icon="🇷🇺" label="RU напрямую" active={info.features.ruDirect} />
              <FeatureBadge icon="🚫" label="Блокировка рекламы" active={info.features.adBlocking} />
              <FeatureBadge icon="🛡️" label="TLS / Replit" active={true} />
            </div>

            {/* Статистика */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
              <StatCard
                label="Подключений"
                value={String(info.stats.totalConnections)}
                sub={`${info.stats.activeConnections} активных`}
              />
              <StatCard
                label="↓ Получено"
                value={formatBytes(info.stats.bytesIn)}
              />
              <StatCard
                label="↑ Отправлено"
                value={formatBytes(info.stats.bytesOut)}
              />
              <StatCard
                label="Аптайм"
                value={formatUptime(info.stats.uptimeSeconds)}
              />
            </div>

            {/* Пользователи */}
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
              Пользователи ({info.users.length})
            </div>
            {info.users.map((user) => (
              <UserCard key={user.uuid} user={user} host={info.host} />
            ))}

            <p style={{ textAlign: "center", fontSize: "11px", color: "#1e293b", marginTop: "24px" }}>
              Статистика обновляется каждые 5 сек • UUID зафиксированы в env vars
            </p>
          </>
        )}

        {!info && !error && (
          <div style={{ textAlign: "center", color: "#475569", paddingTop: "40px" }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>⏳</div>
            Загрузка...
          </div>
        )}
      </div>
    </div>
  );
}
