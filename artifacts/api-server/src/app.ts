import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((_req: Request, res: Response) => {
  res.status(200).set("Content-Type", "text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Service</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 680px; margin: 80px auto; padding: 0 24px; color: #374151; line-height: 1.6; }
    h1 { font-size: 1.5rem; font-weight: 600; color: #111827; }
    p { color: #6b7280; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.875rem; }
    .badge { display: inline-block; padding: 2px 10px; background: #dcfce7; color: #166534; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
  </style>
</head>
<body>
  <h1>API Service Endpoint <span class="badge">online</span></h1>
  <p>This is a backend service. To interact with this API, use a compatible client.</p>
  <p>Base path: <code>/api</code></p>
  <p>Health check: <code>GET /api/healthz</code></p>
</body>
</html>`);
});

export default app;
