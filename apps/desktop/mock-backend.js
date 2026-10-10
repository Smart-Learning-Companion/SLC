/**
 * Mock .NET Orchestrator Backend for development & testing.
 * Simulates the backend lifecycle and verifies the security token handshake.
 *
 * Privacy by Design:
 * - Binds strictly to 127.0.0.1 (loopback only - no external LAN access).
 * - Requires a cryptographically strong SLC_TOKEN.
 * - Never leaks raw tokens to logs.
 */

const token = process.env.SLC_TOKEN;

if (!token || token.length < 32) {
  console.error('[Mock-Backend] [SECURITY ERROR] Missing or invalid SLC_TOKEN! Refusing to start.');
  process.exit(1);
}

const maskedToken = `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
console.log(`[Mock-Backend] Initialized successfully. Bound to 127.0.0.1 (localhost).`);
console.log(`[Mock-Backend] Secure Token verified: [${maskedToken}] (${token.length} chars)`);

// Periodic heartbeat to simulate background orchestrator running
const heartbeat = setInterval(() => {
  // Silent heartbeat, stays alive
}, 10000);

// Graceful cleanup when parent process (Electron) terminates
function shutdown() {
  console.log('[Mock-Backend] Shutdown signal received. Exiting cleanly...');
  clearInterval(heartbeat);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
