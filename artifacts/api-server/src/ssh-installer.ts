import { Client, type ConnectConfig } from "ssh2";
import { randomUUID } from "node:crypto";
import { logger } from "./lib/logger";

export interface SSHTarget {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export interface InstallStep {
  step: string;
  status: "pending" | "running" | "done" | "error";
  message?: string;
}

export type ProgressCallback = (step: InstallStep) => void;

async function runCommand(
  conn: Client,
  cmd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let stdout = "";
      let stderr = "";
      stream.on("data", (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      stream.on("close", (code: number) => resolve({ stdout, stderr, code }));
    });
  });
}

export async function installOnServer(
  target: SSHTarget,
  onProgress: ProgressCallback,
): Promise<{ uuid: string; host: string; wsPath: string }> {
  const conn = new Client();

  const connectCfg: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.username,
    readyTimeout: 15000,
  };
  if (target.privateKey) connectCfg.privateKey = target.privateKey;
  else if (target.password) connectCfg.password = target.password;

  await new Promise<void>((resolve, reject) => {
    conn.on("ready", resolve);
    conn.on("error", reject);
    conn.connect(connectCfg);
  });

  const emit = (step: string, status: InstallStep["status"], message?: string) => {
    onProgress({ step, status, message });
  };

  try {
    emit("os-check", "running");
    const os = await runCommand(conn, "cat /etc/os-release | head -5");
    if (os.code !== 0) throw new Error("Cannot read OS info");
    const isDebian = os.stdout.includes("debian") || os.stdout.includes("ubuntu") || os.stdout.includes("Ubuntu");
    const isRhel = os.stdout.includes("centos") || os.stdout.includes("rhel") || os.stdout.includes("fedora");
    if (!isDebian && !isRhel) throw new Error("Unsupported OS. Требуется Ubuntu/Debian/CentOS");
    emit("os-check", "done", isDebian ? "Ubuntu/Debian" : "CentOS/RHEL");

    emit("install-deps", "running");
    const pkgCmd = isDebian
      ? "apt-get update -qq && apt-get install -y -qq curl unzip nginx 2>&1"
      : "yum install -y -q curl unzip nginx 2>&1";
    const pkgResult = await runCommand(conn, pkgCmd);
    if (pkgResult.code !== 0) throw new Error(`Failed to install deps: ${pkgResult.stderr}`);
    emit("install-deps", "done");

    emit("download-xray", "running");
    const dlResult = await runCommand(
      conn,
      `bash -c "mkdir -p /opt/xray && cd /opt/xray && \
      curl -fsSL https://api.github.com/repos/XTLS/Xray-core/releases/latest \
      | grep 'browser_download_url.*linux-64.zip' | head -1 | cut -d'\"' -f4 \
      | xargs -I{} curl -fsSL {} -o xray.zip && \
      unzip -o xray.zip && chmod +x xray && rm -f xray.zip"`,
    );
    if (dlResult.code !== 0) throw new Error(`Download failed: ${dlResult.stderr}`);
    emit("download-xray", "done");

    emit("configure-xray", "running");
    const uuid = randomUUID();
    const wsPath = "/ws-" + randomUUID().slice(0, 8);
    const xrayConfig = JSON.stringify({
      log: { loglevel: "warning" },
      inbounds: [{
        port: 10808,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: uuid, level: 0, email: "user1@proxy" }],
          decryption: "none",
        },
        streamSettings: {
          network: "ws",
          wsSettings: { path: wsPath },
        },
      }],
      outbounds: [
        { protocol: "freedom", tag: "direct" },
        { protocol: "blackhole", tag: "blocked" },
      ],
      routing: {
        domainStrategy: "IPIfNonMatch",
        rules: [
          { type: "field", domain: ["geosite:category-ads-all"], outboundTag: "blocked" },
          { type: "field", ip: ["geoip:private"], outboundTag: "direct" },
        ],
      },
      stats: {},
      api: {
        tag: "api",
        services: ["StatsService"],
      },
      policy: {
        levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
        system: { statsInboundUplink: true, statsInboundDownlink: true },
      },
    });

    const escapedConfig = xrayConfig.replace(/'/g, "'\\''");
    const cfgResult = await runCommand(conn, `bash -c 'echo '"'"'${escapedConfig}'"'"' > /opt/xray/config.json'`);
    if (cfgResult.code !== 0) throw new Error("Failed to write xray config");
    emit("configure-xray", "done");

    emit("setup-systemd", "running");
    const serviceFile = `[Unit]
Description=Xray VLESS Proxy
After=network.target

[Service]
Type=simple
ExecStart=/opt/xray/xray run -config /opt/xray/config.json
Restart=always
RestartSec=5
Environment=XRAY_LOCATION_ASSET=/opt/xray

[Install]
WantedBy=multi-user.target
`;
    const escapedService = serviceFile.replace(/'/g, "'\\''");
    await runCommand(conn, `bash -c "echo '${escapedService}' > /etc/systemd/system/xray-proxy.service"`);
    await runCommand(conn, "systemctl daemon-reload && systemctl enable xray-proxy && systemctl restart xray-proxy");
    emit("setup-systemd", "done");

    emit("configure-nginx", "running");
    const nginxConf = `server {
    listen 80;
    server_name _;
    location ${wsPath} {
        proxy_pass http://127.0.0.1:10808;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
    location / { return 200 "OK"; add_header Content-Type text/plain; }
}`;
    const escapedNginx = nginxConf.replace(/'/g, "'\\''").replace(/\$/g, "\\$");
    await runCommand(conn, `bash -c "echo '${escapedNginx}' > /etc/nginx/conf.d/xray-proxy.conf"`);
    await runCommand(conn, "nginx -t && systemctl restart nginx");
    emit("configure-nginx", "done");

    emit("verify", "running");
    await new Promise(r => setTimeout(r, 2000));
    const check = await runCommand(conn, "systemctl is-active xray-proxy");
    if (!check.stdout.trim().startsWith("active")) throw new Error("xray-proxy service not active");
    emit("verify", "done", "Сервер готов!");

    conn.end();
    return { uuid, host: target.host, wsPath };

  } catch (err) {
    conn.end();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "SSH install failed");
    throw new Error(msg);
  }
}
