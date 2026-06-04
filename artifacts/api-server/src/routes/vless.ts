import { Router, type IRouter } from "express";
import { getUsers, getHost } from "../xray";
import { trafficStats } from "../index";

const router: IRouter = Router();

router.get("/vless-info", (_req, res) => {
  const users = getUsers();
  const host = getHost();

  const userLinks = users.map((u) => ({
    label: u.label,
    uuid: u.uuid,
    vlessLink: `vless://${u.uuid}@${host}:443?encryption=none&security=tls&type=ws&path=%2Fws#${encodeURIComponent(u.label)}`,
  }));

  const uptimeSeconds = Math.floor((Date.now() - trafficStats.startTime) / 1000);

  res.json({
    host,
    port: 443,
    path: "/ws",
    users: userLinks,
    features: {
      geoRouting: true,
      adBlocking: true,
      ruDirect: true,
    },
    stats: {
      totalConnections: trafficStats.totalConnections,
      activeConnections: trafficStats.activeConnections,
      bytesIn: trafficStats.bytesIn,
      bytesOut: trafficStats.bytesOut,
      uptimeSeconds,
    },
  });
});

export default router;
