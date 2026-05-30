import http from "node:http";
import httpProxy from "http-proxy";
import app from "./app";
import { logger } from "./lib/logger";
import { startXray, XRAY_INTERNAL_PORT } from "./xray";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

const wsProxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${XRAY_INTERNAL_PORT}`,
});

wsProxy.on("error", (err, _req, res) => {
  logger.error({ err }, "WebSocket proxy error");
  if (res && "writeHead" in res) {
    (res as http.ServerResponse).writeHead(502, {
      "Content-Type": "text/plain",
    });
    (res as http.ServerResponse).end("Bad Gateway");
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    logger.info("Upgrading WebSocket connection → xray");
    wsProxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

startXray().catch((err) => {
  logger.error({ err }, "Failed to start xray — proxy will not be available");
});
