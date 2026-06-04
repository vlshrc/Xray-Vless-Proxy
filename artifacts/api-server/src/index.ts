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

export const trafficStats = {
  totalConnections: 0,
  activeConnections: 0,
  bytesIn: 0,
  bytesOut: 0,
  startTime: Date.now(),
};

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
    trafficStats.totalConnections++;
    trafficStats.activeConnections++;

    socket.on("data", (chunk: Buffer) => {
      trafficStats.bytesIn += chunk.length;
    });

    const origWrite = socket.write.bind(socket);
    socket.write = (chunk: Buffer | string, ...args: unknown[]) => {
      if (Buffer.isBuffer(chunk)) trafficStats.bytesOut += chunk.length;
      else if (typeof chunk === "string") trafficStats.bytesOut += Buffer.byteLength(chunk);
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    };

    socket.on("close", () => {
      trafficStats.activeConnections = Math.max(0, trafficStats.activeConnections - 1);
    });

    logger.info("WebSocket connection → xray");
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
