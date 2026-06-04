import { Router, type IRouter, type Request, type Response } from "express";
import { installOnServer, type SSHTarget, type InstallStep } from "../ssh-installer";
import { loadSettings, saveSettings } from "../settings";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/servers/install", async (req: Request, res: Response) => {
  const { host, port, username, password, privateKey, name } = req.body as {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    name?: string;
  };

  if (!host || !username || (!password && !privateKey)) {
    res.status(400).json({ ok: false, error: "host, username и password/privateKey обязательны" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const target: SSHTarget = {
    host,
    port: port ?? 22,
    username,
    password,
    privateKey,
  };

  try {
    sendEvent({ type: "start", message: `Подключение к ${host}...` });

    const result = await installOnServer(target, (step: InstallStep) => {
      sendEvent({ type: "step", ...step });
    });

    const settings = loadSettings();
    const serverId = `vps-${host.replace(/\./g, "-")}`;
    const existing = settings.servers.findIndex((s) => s.id === serverId);

    const newServer = {
      id: serverId,
      name: name ?? `VPS ${host}`,
      enabled: true,
      host: result.host,
      wsPath: result.wsPath,
      uuid: result.uuid,
      routing: {
        ruDirect: true,
        adBlocking: true,
        privateDirect: true,
      },
      transport: {
        wsPath: result.wsPath,
      },
    };

    if (existing >= 0) settings.servers[existing] = newServer;
    else settings.servers.push(newServer);
    saveSettings(settings);

    logger.info({ host, serverId }, "VPS server installed and added to settings");

    sendEvent({ type: "done", server: newServer, uuid: result.uuid, wsPath: result.wsPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, host }, "SSH install failed");
    sendEvent({ type: "error", message });
  } finally {
    res.end();
  }
});

export default router;
