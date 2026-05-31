const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const { execSync, spawn } = require('child_process');
const { mkdirSync, writeFileSync, chmodSync } = require('fs');
const { randomUUID } = require('crypto');
const AdmZip = require('adm-zip');
const path = require('path');

const PORT = process.env.PORT || 3000;
const XRAY_PORT = 10808;
const DATA_DIR = '/tmp/xray-data';
const XRAY_BIN = path.join(DATA_DIR, 'xray');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const UUID = process.env.VLESS_UUID || (() => {
  const id = randomUUID();
  console.warn(`\nWARNING: VLESS_UUID env var not set.`);
  console.warn(`UUID will change on every restart!`);
  console.warn(`Fix: add VLESS_UUID=${id} to Render environment variables.\n`);
  return id;
})();

function getHost() {
  if (process.env.RENDER_EXTERNAL_URL) {
    try { return new URL(process.env.RENDER_EXTERNAL_URL).hostname; } catch (_) {}
  }
  if (process.env.REPLIT_DOMAINS) return process.env.REPLIT_DOMAINS.split(',')[0].trim();
  if (process.env.REPLIT_DEV_DOMAIN) return process.env.REPLIT_DEV_DOMAIN;
  return 'localhost';
}

async function downloadXray() {
  console.log('Fetching latest xray-core release...');
  const res = await fetch('https://api.github.com/repos/XTLS/Xray-core/releases/latest', {
    headers: { 'User-Agent': 'xray-proxy/1.0' }
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  console.log(`Latest release: ${data.tag_name}`);

  const asset = data.assets.find(a =>
    a.name.toLowerCase().includes('linux') &&
    (a.name.includes('64') || a.name.includes('amd64')) &&
    !a.name.toLowerCase().includes('arm') &&
    !a.name.toLowerCase().includes('arm64') &&
    a.name.endsWith('.zip')
  );
  if (!asset) throw new Error(`No linux-64 asset. Available: ${data.assets.map(a => a.name).join(', ')}`);

  console.log(`Downloading ${asset.name}...`);
  const zipPath = path.join(DATA_DIR, 'xray.zip');
  execSync(`curl -fsSL "${asset.browser_download_url}" -o "${zipPath}"`, { stdio: 'inherit' });

  console.log('Extracting...');
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntries().find(e => e.entryName === 'xray' || e.entryName.endsWith('/xray'));
  if (!entry) throw new Error(`No xray binary in zip. Files: ${zip.getEntries().map(e => e.entryName).join(', ')}`);
  zip.extractEntryTo(entry, DATA_DIR, false, true);
  chmodSync(XRAY_BIN, 0o755);
  console.log('xray ready.');
}

function writeConfig() {
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [{
      port: XRAY_PORT,
      listen: '127.0.0.1',
      protocol: 'vless',
      settings: {
        clients: [{ id: UUID, level: 0 }],
        decryption: 'none'
      },
      streamSettings: {
        network: 'ws',
        wsSettings: { path: '/ws' }
      }
    }],
    outbounds: [{ protocol: 'freedom', settings: {} }]
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function startXray() {
  const xray = spawn(XRAY_BIN, ['run', '-config', CONFIG_FILE], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  xray.stdout.on('data', d => { const l = d.toString().trim(); if (l) console.log('[xray]', l); });
  xray.stderr.on('data', d => { const l = d.toString().trim(); if (l) console.log('[xray]', l); });
  xray.on('exit', code => console.error(`[xray] process exited with code ${code}`));
  return xray;
}

function startPingLoop() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) {
    console.log('[ping] RENDER_EXTERNAL_URL not set, ping loop disabled.');
    return;
  }
  console.log(`[ping] Will ping ${url} every 10 minutes to prevent sleep.`);
  setInterval(() => {
    fetch(url).catch(err => console.error('[ping] error:', err.message));
    console.log(`[ping] ${new Date().toISOString()}`);
  }, 10 * 60 * 1000);
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  await downloadXray();
  writeConfig();
  startXray();

  const app = express();
  app.get('/', (_req, res) => res.status(200).send('OK'));
  app.use((_req, res) => res.status(200).send('OK'));

  const server = http.createServer(app);

  const wsProxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${XRAY_PORT}` });
  wsProxy.on('error', (err) => console.error('[ws-proxy] error:', err.message));

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wsProxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, () => {
    const host = getHost();
    const vless = `vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&path=%2Fws#Render-Proxy`;

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║         VLESS CONNECTION STRING (V2RayNG)                ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║');
    console.log(` ${vless}`);
    console.log('║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`\nHost: ${host}`);
    console.log(`UUID: ${UUID}`);
    console.log(`Port: 443  |  Transport: ws  |  Path: /ws  |  TLS: tls`);
    console.log(`Server listening on port ${PORT}\n`);
  });

  startPingLoop();
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
