import { Router, type IRouter, type Request, type Response } from "express";
import {
  loadSettings,
  updateServerSettings,
  type ServerSettings,
} from "../settings";
import { reloadXray } from "../xray";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/settings", (_req: Request, res: Response) => {
  const settings = loadSettings();
  res.json(settings);
});

router.patch(
  "/settings/servers/:id",
  async (req: Request, res: Response) => {
    const id = Array.isArray(req.params["id"]) ? req.params["id"][0]! : req.params["id"]!;
    const patch = req.body as Partial<ServerSettings>;

    try {
      const updated = updateServerSettings(id, patch);
      logger.info({ id, patch }, "Server settings updated");

      if (id === "replit-main") {
        logger.info("Reloading xray with new settings...");
        await reloadXray();
        logger.info("Xray reloaded successfully");
      }

      res.json({ ok: true, server: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err }, "Failed to update settings");
      res.status(400).json({ ok: false, error: message });
    }
  },
);

export default router;
