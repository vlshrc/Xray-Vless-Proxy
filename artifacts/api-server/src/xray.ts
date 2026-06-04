import { execSync, spawn, type ChildProcess } from "node:child_process";
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
import { getServerSettings } from "./settings";

const DATA_DIR = "/tmp/xray-data";
const UUID_FILE = path.join(process.cwd(), "xray-data", "uuid");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const XRAY_BIN = path.join(DATA_DIR, "xray");
export const XRAY_INTERNAL_PORT = 10808;

export interface XrayUser {
  label: string;
  uuid: string;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

let xrayProcess: ChildProcess | null = null;

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

function getOrCreatePrimaryUUID(): string {
  if (process.env["VLESS_UUID"]) {
    return process.env["VLESS_UUID"].trim();
  }
  if (existsSync(UUID_FILE)) {
    return readFileSync(UUID_FILE, "utf-8").trim();
  }
  const uuid = randomUUID();
  mkdirSync(path.dirname(UUID_FILE), { recursive: true });
  writeFileSync(UUID_FILE, uuid, "utf-8");
  logger.warn({ uuid }, "VLESS_UUID not set — generated fallback UUID");
  return uuid;
}

export function getUsers(): XrayUser[] {
  const users: XrayUser[] = [];

  const primary = getOrCreatePrimaryUUID();
  users.push({ label: "Пользователь 1", uuid: primary });

  const uuid2 = process.env["VLESS_UUID_2"]?.trim();
  if (uuid2) users.push({ label: "Пользователь 2", uuid: uuid2 });

  const uuid3 = process.env["VLESS_UUID_3"]?.trim();
  if (uuid3) users.push({ label: "Пользователь 3", uuid: uuid3 });

  return users;
}

export function getHost(): string {
  if (process.env["REPLIT_DOMAINS"]) {
    return process.env["REPLIT_DOMAINS"].split(",")[0]!.trim();
  }
  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return process.env["REPLIT_DEV_DOMAIN"];
  }
  if (process.env["REPL_SLUG"] && process.env["REPL_OWNER"]) {
    return `${process.env["REPL_SLUG"]}.${process.env["REPL_OWNER"]}.repl.co`;
  }
  return "localhost";
}

function buildRoutingRules(): object[] {
  const srv = getServerSettings("replit-main");
  const routing = srv?.routing ?? {
    ruDirect: true,
    adBlocking: true,
    privateDirect: true,
  };

  const rules: object[] = [];

  if (routing.adBlocking) {
    rules.push({
      type: "field",
      domain: ["geosite:category-ads-all"],
      outboundTag: "blocked",
    });
  }

  if (routing.privateDirect) {
    rules.push({
      type: "field",
      domain: ["geosite:private"],
      outboundTag: "direct",
    });
  }

  const directIPs: string[] = [];
  if (routing.privateDirect) directIPs.push("geoip:private");
  if (routing.ruDirect) directIPs.push("geoip:ru");

  if (directIPs.length > 0) {
    rules.push({
      type: "field",
      ip: directIPs,
      outboundTag: "direct",
    });
  }

  return rules;
}

function writeXrayConfig(users: XrayUser[]): void {
  const srv = getServerSettings("replit-main");
  const wsPath = srv?.transport?.wsPath ?? "/ws";

  const config = {
    log: { loglevel: "warning" },
    inbounds: [
      {
        port: XRAY_INTERNAL_PORT,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: users.map((u, i) => ({
            id: u.uuid,
            level: 0,
            email: `user${i + 1}@proxy`,
          })),
          decryption: "none",
        },
        streamSettings: {
          network: "ws",
          wsSettings: { path: wsPath },
        },
      },
    ],
    outbounds: [
      { protocol: "freedom", settings: {}, tag: "direct" },
      { protocol: "blackhole", settings: {}, tag: "blocked" },
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: buildRoutingRules(),
    },
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

async function ensureXrayBinary(): Promise<void> {
  const geoipPath = path.join(DATA_DIR, "geoip.dat");
  const geositePath = path.join(DATA_DIR, "geosite.dat");
  const needsGeoFiles = !existsSync(geoipPath) || !existsSync(geositePath);

  if (existsSync(XRAY_BIN) && !needsGeoFiles) {
    logger.info("xray binary and geo files present, skipping download");
    return;
  }

  logger.info("Downloading xray-core binary and geo data files...");
  const url = await getLatestXrayAssetUrl();
  const zipPath = path.join(DATA_DIR, "xray.zip");

  execSync(`curl -fsSL "${url}" -o "${zipPath}"`, { stdio: "inherit" });
  logger.info("Download complete, extracting...");

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  logger.info({ files: entries.map((e) => e.entryName) }, "Zip contents");

  const wanted = ["xray", "geoip.dat", "geosite.dat"];
  for (const name of wanted) {
    const entry = entries.find(
      (e) => e.entryName === name || e.entryName.endsWith(`/${name}`),
    );
    if (entry) {
      zip.extractEntryTo(entry, DATA_DIR, false, true);
      logger.info({ file: name }, "Extracted");
    } else {
      logger.warn({ file: name }, "Not found in zip");
    }
  }

  if (!existsSync(XRAY_BIN)) {
    throw new Error(`xray binary not found at ${XRAY_BIN} after extraction.`);
  }

  chmodSync(XRAY_BIN, 0o755);
  logger.info("xray-core ready");
}

function spawnXray(): void {
  const users = getUsers();
  writeXrayConfig(users);

  const proc = spawn(XRAY_BIN, ["run", "-config", CONFIG_FILE], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XRAY_LOCATION_ASSET: DATA_DIR },
  });

  xrayProcess = proc;

  proc.stdout.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) logger.info(`[xray] ${line}`);
  });
  proc.stderr.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) logger.warn(`[xray] ${line}`);
  });
  proc.on("exit", (code) => {
    if (xrayProcess === proc) {
      logger.error({ code }, "xray process exited unexpectedly");
      xrayProcess = null;
    }
  });
}

export async function reloadXray(): Promise<void> {
  logger.info("Reloading xray with updated config...");

  if (xrayProcess) {
    xrayProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        xrayProcess?.kill("SIGKILL");
        resolve();
      }, 3000);
      xrayProcess!.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    xrayProcess = null;
  }

  spawnXray();
  logger.info("xray reloaded");
}

export async function startXray(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });

  await ensureXrayBinary();

  spawnXray();

  const host = getHost();
  const users = getUsers();

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       VLESS PROXY — CONNECTION STRINGS                       ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  for (const user of users) {
    const link = `vless://${user.uuid}@${host}:443?encryption=none&security=tls&type=ws&path=%2Fws#${encodeURIComponent(user.label)}`;
    console.log(`║ ${user.label}:`);
    console.log(`  ${link}`);
  }
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`Routing:  🇷🇺 RU → direct | 🌍 Global → proxy | 🚫 Ads → blocked`);
  console.log(`Users:    ${users.length} configured`);
  console.log("");
}
