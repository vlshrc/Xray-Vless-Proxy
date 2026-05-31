# api-service

Express API server with WebSocket support.

## Deploy on Render

1. Fork or push this repo to your GitHub account
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repository
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Environment:** Node
5. Add environment variables:
   - `VLESS_UUID` — your UUID (keep secret, paste from setup output)
   - `RENDER_EXTERNAL_URL` — your Render service URL (e.g. `https://api-service-xxxx.onrender.com`)
6. Deploy

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VLESS_UUID` | Yes | Fixed UUID for VLESS client auth. Without it a new UUID is generated on every restart. |
| `RENDER_EXTERNAL_URL` | Yes | Full URL of this service. Used for keep-alive ping every 10 min. |
| `PORT` | Auto | Set automatically by Render. |

## Usage

After deploy, check the service logs for the connection string:

```
vless://UUID@your-service.onrender.com:443?encryption=none&security=tls&type=ws&path=%2Fws#Render-Proxy
```

Import into V2RayNG via QR code or paste the string directly.
