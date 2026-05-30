import { Router, type IRouter } from "express";

const router: IRouter = Router();

function getHost(): string {
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

router.get("/vless-info", (_req, res) => {
  const uuid = process.env["VLESS_UUID"] ?? "not-configured";
  const host = getHost();
  const vlessLink = `vless://${uuid}@${host}:443?encryption=none&security=tls&type=ws&path=%2Fws#Replit-Proxy`;

  res.json({ uuid, host, port: 443, path: "/ws", vlessLink });
});

export default router;
