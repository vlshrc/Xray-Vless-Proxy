import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SETTINGS_DIR = path.join(process.cwd(), "xray-data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

export interface ServerSettings {
  id: string;
  name: string;
  enabled: boolean;
  routing: {
    ruDirect: boolean;
    adBlocking: boolean;
    privateDirect: boolean;
  };
  transport: {
    wsPath: string;
  };
}

export interface AppSettings {
  servers: ServerSettings[];
}

const DEFAULT_SETTINGS: AppSettings = {
  servers: [
    {
      id: "replit-main",
      name: "Replit (основной)",
      enabled: true,
      routing: {
        ruDirect: true,
        adBlocking: true,
        privateDirect: true,
      },
      transport: {
        wsPath: "/ws",
      },
    },
  ],
};

export function loadSettings(): AppSettings {
  if (!existsSync(SETTINGS_FILE)) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as AppSettings;
    if (!parsed.servers || !Array.isArray(parsed.servers)) {
      return DEFAULT_SETTINGS;
    }
    return parsed;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

export function getServerSettings(id: string): ServerSettings | undefined {
  return loadSettings().servers.find((s) => s.id === id);
}

export function updateServerSettings(
  id: string,
  patch: Partial<ServerSettings>,
): ServerSettings {
  const settings = loadSettings();
  const idx = settings.servers.findIndex((s) => s.id === id);

  if (idx === -1) {
    throw new Error(`Server "${id}" not found`);
  }

  const updated: ServerSettings = {
    ...settings.servers[idx]!,
    ...patch,
    routing: {
      ...settings.servers[idx]!.routing,
      ...(patch.routing ?? {}),
    },
    transport: {
      ...settings.servers[idx]!.transport,
      ...(patch.transport ?? {}),
    },
  };

  settings.servers[idx] = updated;
  saveSettings(settings);
  return updated;
}
