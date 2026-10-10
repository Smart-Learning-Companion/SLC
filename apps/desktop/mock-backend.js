/**
 * Mock .NET Orchestrator Backend for development & testing.
 * Complies with contracts v1 (docs/contracts/):
 * - launch-and-token.md
 * - session-and-help.md
 * - context.md
 *
 * Privacy & Security by Design:
 * - Binds strictly to 127.0.0.1 (loopback only - no external network exposure).
 * - Verifies SLC_TOKEN; token is kept in memory and never logged to stdout/stderr.
 * - Enforces Authorization: Bearer <token> on all endpoints except /health.
 * - Screen frames received via /context/frame are kept in ephemeral memory and never saved to disk.
 */

import http from 'http';

const token = process.env.SLC_TOKEN;
const port = parseInt(process.env.SLC_PORT || '5050', 10);
const mlPort = parseInt(process.env.SLC_ML_PORT || '5051', 10);
const dataDir = process.env.SLC_DATA_DIR || './data';

if (!token || token.length < 32) {
  console.error('[Mock-Backend] [SECURITY ERROR] Missing or invalid SLC_TOKEN! Refusing to start.');
  process.exit(1);
}

// Contract rule: "The token lives only in process env and memory. Never log it."
console.log(`[Mock-Backend] Initializing service on 127.0.0.1:${port}...`);
console.log(`[Mock-Backend] Environment verified: ML Port=${mlPort}, DataDir=${dataDir}`);
console.log(`[Mock-Backend] Security token verified (active in-memory authentication).`);

let activeSessionId = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  // Helper for JSON responses
  const sendJson = (status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
    });
    res.end(JSON.stringify(data));
  };

  // Helper for empty responses
  const sendEmpty = (status) => {
    res.writeHead(status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
    });
    res.end();
  };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Id',
    });
    res.end();
    return;
  }

  // 1. Health check — no auth required (contract: "GET /health none 200 {"status": "ok"}")
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(200, { status: 'ok' });
  }

  // 2. Token Authentication for all other endpoints
  const authHeader = req.headers['authorization'] || '';
  const expectedAuth = `Bearer ${token}`;
  if (authHeader !== expectedAuth) {
    console.warn(`[Mock-Backend] [AUTH REJECTED] Unauthorized request to ${url.pathname}`);
    return sendJson(401, { error: 'Unauthorized: Invalid or missing session token' });
  }

  // 3. Contract: POST /session/start
  if (req.method === 'POST' && url.pathname === '/session/start') {
    activeSessionId = `s_${Date.now()}`;
    console.log(`[Mock-Backend] Session started: ${activeSessionId}`);
    return sendJson(200, { sessionId: activeSessionId });
  }

  // 4. Contract: POST /session/pause
  if (req.method === 'POST' && url.pathname === '/session/pause') {
    console.log(`[Mock-Backend] Session paused: ${activeSessionId}`);
    return sendEmpty(204);
  }

  // 5. Contract: POST /session/stop
  if (req.method === 'POST' && url.pathname === '/session/stop') {
    console.log(`[Mock-Backend] Session stopped: ${activeSessionId}`);
    activeSessionId = null;
    return sendEmpty(204);
  }

  // 6. Contract: POST /help/now
  if (req.method === 'POST' && url.pathname === '/help/now') {
    console.log(`[Mock-Backend] Quick Help requested for session: ${activeSessionId}`);
    return sendEmpty(202);
  }

  // 7. Contract: POST /context/frame (UI -> .NET)
  if (req.method === 'POST' && url.pathname === '/context/frame') {
    const requestId = req.headers['x-request-id'] || 'unspecified';
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      console.log(`[Mock-Backend] Received frame payload: ${buffer.length} bytes (RequestId: ${requestId}) [IN-MEMORY ONLY - UNSAVED]`);
      sendEmpty(202);
    });
    return;
  }

  // 8. Contract: GET /analytics/timeline & /summary
  if (req.method === 'GET' && url.pathname === '/analytics/timeline') {
    return sendJson(200, [{ t: Math.floor(Date.now() / 1000), state: 'focused' }]);
  }

  if (req.method === 'GET' && url.pathname === '/analytics/summary') {
    return sendJson(200, { focusedPct: 1.0, alerts: 0, accepted: 0 });
  }

  // Default: Not Found
  sendJson(404, { error: 'Endpoint not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[Mock-Backend] HTTP REST service listening on http://127.0.0.1:${port}`);
});

// Graceful cleanup when parent process (Electron) terminates
function shutdown() {
  console.log('[Mock-Backend] Shutdown signal received. Closing server and exiting cleanly...');
  server.close(() => {
    process.exit(0);
  });
  // Force exit if connections take too long
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
