import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface VlessInfo {
  uuid: string;
  host: string;
  port: number;
  path: string;
  vlessLink: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
      style={{
        background: copied ? "#22c55e" : "#3b82f6",
        color: "#fff",
        border: "none",
        cursor: "pointer",
      }}
    >
      {copied ? "✓ Скопировано" : "Копировать"}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "14px", color: "#e2e8f0", fontFamily: "monospace", wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}

export default function App() {
  const [info, setInfo] = useState<VlessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vless-info")
      .then((r) => r.json())
      .then((d: VlessInfo) => setInfo(d))
      .catch(() => setError("Не удалось получить конфиг. Убедитесь что сервер запущен."));
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      color: "#e2e8f0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: "520px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>🔒</div>
          <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#f1f5f9", margin: "0 0 6px" }}>
            Replit VLESS Proxy
          </h1>
          <p style={{ fontSize: "14px", color: "#64748b", margin: 0 }}>
            Добавьте в V2RayNG — сканируйте QR или вставьте ссылку
          </p>
        </div>

        {error && (
          <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "12px", padding: "16px", color: "#fca5a5", textAlign: "center" }}>
            {error}
          </div>
        )}

        {!info && !error && (
          <div style={{ textAlign: "center", color: "#64748b" }}>Загрузка...</div>
        )}

        {info && (
          <>
            {/* QR код */}
            <div style={{
              background: "#1e293b",
              borderRadius: "16px",
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginBottom: "16px",
              border: "1px solid #334155",
            }}>
              <div style={{ background: "#fff", padding: "12px", borderRadius: "10px", marginBottom: "16px" }}>
                <QRCodeSVG value={info.vlessLink} size={200} />
              </div>
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                Сканируйте в V2RayNG → + → QR код
              </p>
            </div>

            {/* VLESS ссылка */}
            <div style={{
              background: "#1e293b",
              borderRadius: "16px",
              padding: "20px",
              marginBottom: "16px",
              border: "1px solid #334155",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#94a3b8" }}>VLESS ССЫЛКА</span>
                <CopyButton text={info.vlessLink} />
              </div>
              <div style={{
                background: "#0f172a",
                borderRadius: "8px",
                padding: "12px",
                fontSize: "12px",
                fontFamily: "monospace",
                color: "#7dd3fc",
                wordBreak: "break-all",
                lineHeight: "1.6",
              }}>
                {info.vlessLink}
              </div>
            </div>

            {/* Параметры */}
            <div style={{
              background: "#1e293b",
              borderRadius: "16px",
              padding: "20px",
              border: "1px solid #334155",
            }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#94a3b8", marginBottom: "16px" }}>
                ПАРАМЕТРЫ ВРУЧНУЮ
              </div>
              <Field label="Протокол" value="VLESS" />
              <Field label="Адрес (Address)" value={info.host} />
              <Field label="Порт (Port)" value={String(info.port)} />
              <Field label="UUID" value={info.uuid} />
              <Field label="Шифрование (Encryption)" value="none" />
              <Field label="Транспорт (Network)" value="ws" />
              <Field label="Путь (Path)" value={info.path} />
              <Field label="Безопасность (TLS)" value="tls" />
            </div>

            <p style={{ textAlign: "center", fontSize: "12px", color: "#334155", marginTop: "20px" }}>
              UUID зафиксирован и не меняется при перезапусках
            </p>
          </>
        )}
      </div>
    </div>
  );
}
