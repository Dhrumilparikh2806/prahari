/**
 * mock-server/index.js — PRAHARI Mock Sync Server
 *
 * Simulates the AWS Lambda + S3 sync endpoint for demo purposes.
 * Logs every incoming attendance batch to the console.
 *
 * Usage:
 *   node mock-server/index.js
 *
 * Then configure src/config/awsConfig.ts LAMBDA_ENDPOINT to:
 *   Emulator:  http://10.0.2.2:3001/sync
 *   Real device (same WiFi): http://192.168.X.X:3001/sync
 */

const http = require('http');

const PORT = 3001;

const server = http.createServer((req, res) => {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/sync') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const logCount = data.logs?.length ?? data.logCount ?? 0;
        const deviceId = data.deviceId ?? 'unknown';
        console.log(`[mock-sync] ${new Date().toISOString()} — Received ${logCount} log(s) from device ${deviceId.slice(0, 8)}…`);
        if (data.logs) {
          data.logs.forEach((log, i) => {
            console.log(`  [${i + 1}] personnel=${log.personnelId?.slice(0, 8)} ts=${log.timestamp} conf=${log.confidence} bpm=${log.bpm}`);
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, synced: logCount, url: `https://mock-s3/prahari/logs/${deviceId}.json` }));
      } catch (err) {
        console.error('[mock-sync] Parse error:', err.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-sync] Running on http://0.0.0.0:${PORT}`);
  console.log(`[mock-sync] Emulator endpoint:     http://10.0.2.2:${PORT}/sync`);
  console.log(`[mock-sync] Physical device:       http://<YOUR-LAN-IP>:${PORT}/sync`);
  console.log(`[mock-sync] Health check:          http://localhost:${PORT}/health`);
});
