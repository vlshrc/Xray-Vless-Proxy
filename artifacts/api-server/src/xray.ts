import { execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { logger } from "./lib/logger";
import path from "node:path";

const DATA_DIR = "/tmp/xray-data";
const UUID_FILE = path.join(process.cwd(), "xray-data", "uuid");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const XRAY_BIN = path.join(DATA_DIR, "xray");
export const XRAY_INTERNAL_PORT = 10808;

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

async function getLatestXrayAssetUrl(): Promise<string> {
  logger.info("Fetching latest xray-core release info from GitHub...");
  const res = await fetch(
    "https://api.github.com/repos/XTLS/Xray-core/releases/latest",
    { headers: { "User-Agent": "xray-replit-proxy/1.0" } },
  );
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);

  const data = (await res.json()) as GithubRelease;
  logger.info({ tag: data.tag_name }, "Latest xray-core release");

  const asset = data.assets.find(
    (a) =>
      a.name.toLowerCase().includes("linux") &&
      (a.name.includes("64") || a.name.includes("amd64")) &&
      !a.name.toLowerCase().includes("arm") &&
      !a.name.toLowerCase().includes("arm64") &&
      a.name.endsWith(".zip"),
  );

  if (!asset) {
    const names = data.assets.map((a) => a.name).join(", ");
    throw new Error(`Could not find linux-64 asset. Available: ${names}`);
  }

  logger.info({ asset: asset.name }, "Found xray asset");
  return asset.browser_download_url;
}

function getUUID(): string {
  if (process.env["VLESS_UUID"]) {
    const uuid = process.env["VLESS_UUID"].trim();
    logger.info({ uuid }, "Using VLESS_UUID from environment");
    return uuid;
  }
  if (existsSync(UUID_FILE)) {
    const uuid = readFileSync(UUID_FILE, "utf-8").trim();
    logger.info({ uuid }, "Loaded existing VLESS UUID from file");
    return uuid;
  }
  const uuid = randomUUID();
  mkdirSync(path.dirname(UUID_FILE), { recursive: true });
  writeFileSync(UUID_FILE, uuid, "utf-8");
  logger.warn(
    { uuid },
    "VLESS_UUID env var not set — generated new UUID (set VLESS_UUID env var to keep it stable across restarts)",
  );
  return uuid;
}

function getHost(): string {
  if (process.env["REPLIT_DOMAINS"]) {
    const first = process.env["REPLIT_DOMAINS"].split(",")[0]!.trim();
    return first;
  }
  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return process.env["REPLIT_DEV_DOMAIN"];
  }
  if (process.env["REPL_SLUG"] && process.env["REPL_OWNER"]) {
    return `${process.env["REPL_SLUG"]}.${process.env["REPL_OWNER"]}.repl.co`;
  }
  return "localhost";
}

function writeXrayConfig(uuid: string): void {
  const config = {
    log: { loglevel: "warning" },
    inbounds: [
      {
        port: XRAY_INTERNAL_PORT,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: uuid, level: 0 }],
          decryption: "none",
        },
        streamSettings: {
          network: "ws",
          wsSettings: { path: "/ws" },
        },
      },
    ],
    outbounds: [{ protocol: "freedom", settings: {} }],
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

async function ensureXrayBinary(): Promise<void> {
  if (existsSync(XRAY_BIN)) {
    logger.info("xray binary already present in /tmp, skipping download");
    return;
  }

  logger.info("Downloading xray-core binary...");
  const url = await getLatestXrayAssetUrl();
  const zipPath = path.join(DATA_DIR, "xray.zip");

  execSync(`curl -fsSL "${url}" -o "${zipPath}"`, { stdio: "inherit" });
  logger.info("Download complete, extracting...");

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  logger.info({ files: entries.map((e) => e.entryName) }, "Zip contents");

  const xrayEntry = entries.find(
    (e) => e.entryName === "xray" || e.entryName.endsWith("/xray"),
  );

  if (!xrayEntry) {
    throw new Error(
      `No 'xray' binary found in zip. Files: ${entries.map((e) => e.entryName).join(", ")}`,
    );
  }

  zip.extractEntryTo(xrayEntry, DATA_DIR, false, true);

  if (!existsSync(XRAY_BIN)) {
    throw new Error(`xray binary not found at ${XRAY_BIN} after extraction.`);
  }

  chmodSync(XRAY_BIN, 0o755);
  logger.info("xray-core binary ready");
}

export async function startXray(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });

  await ensureXrayBinary();

  const uuid = getUUID();
  writeXrayConfig(uuid);

  const xray = spawn(XRAY_BIN, ["run", "-config", CONFIG_FILE], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  xray.stdout.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) logger.info(`[xray] ${line}`);
  });
  xray.stderr.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) logger.warn(`[xray] ${line}`);
  });
  xray.on("exit", (code) => {
    logger.error({ code }, "xray process exited unexpectedly");
  });

  const host = getHost();
  const vlessLink = `vless://${uuid}@${host}:443?encryption=none&security=tls&type=ws&path=%2Fws#Replit-Proxy`;

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          VLESS CONNECTION STRING FOR V2RayNG                 ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║");
  console.log(`  ${vlessLink}`);
  console.log("║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`Host:      ${host}`);
  console.log(`Port:      443`);
  console.log(`UUID:      ${uuid}`);
  console.log(`Transport: WebSocket  Path: /ws`);
  console.log(`Security:  TLS (handled by Replit)`);
  console.log("");
}
