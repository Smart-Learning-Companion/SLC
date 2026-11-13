import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-load dev.ps1 config if present
function loadDevEnv() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const devPs1 = path.join(home, '.config', 'slc', 'dev.ps1');
  if (fs.existsSync(devPs1)) {
    try {
      const content = fs.readFileSync(devPs1, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\$env:([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/);
        if (match) {
          const [, key, val] = match;
          process.env[key] = val;
        }
      }
      console.log('[SLC Desktop Runner] Loaded Gemini configuration from dev.ps1');
    } catch { /* ignore */ }
  }

  // Ensure default models are set (gemini-3.5-flash-lite is active and tested)
  if (!process.env.SLC_GEMINI_MODEL || process.env.SLC_GEMINI_MODEL.includes('2.5')) {
    process.env.SLC_GEMINI_MODEL = 'gemini-3.5-flash-lite';
  }
  if (!process.env.SLC_GEMINI_FALLBACK_MODEL || process.env.SLC_GEMINI_FALLBACK_MODEL.includes('2.5')) {
    process.env.SLC_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
  }
}

loadDevEnv();

const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

console.log('[SLC Desktop Runner] Starting Vite dev server...');

// 1. Start Vite dev server
const viteProcess = spawn(npmCmd, ['run', 'dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
});

let electronProcess = null;
let isShuttingDown = false;
let hasLaunchedElectron = false;

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n[SLC Desktop Runner] Shutting down all processes...');

  if (electronProcess && !electronProcess.killed) {
    try { electronProcess.kill(); } catch { /* ignore */ }
  }

  if (viteProcess && !viteProcess.killed) {
    try {
      if (isWindows && viteProcess.pid) {
        spawn('taskkill', ['/pid', viteProcess.pid.toString(), '/T', '/F']);
      } else {
        viteProcess.kill('SIGTERM');
      }
    } catch { /* ignore */ }
  }

  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// 2. Poll until Vite dev server is responding (ONCE only)
function waitForVite(onReady) {
  let finished = false;

  const poll = () => {
    if (finished || isShuttingDown) return;

    const req = http.get(VITE_URL, (res) => {
      if (finished || isShuttingDown) return;
      finished = true;
      res.resume();
      onReady();
    });

    req.on('error', () => {
      if (!finished && !isShuttingDown) {
        setTimeout(poll, 400);
      }
    });

    req.setTimeout(800, () => {
      req.destroy();
      if (!finished && !isShuttingDown) {
        setTimeout(poll, 400);
      }
    });
  };

  poll();
}

waitForVite(() => {
  if (hasLaunchedElectron || isShuttingDown) return;
  hasLaunchedElectron = true;

  console.log('[SLC Desktop Runner] Vite server is ready. Launching Electron App...');

  // 3. Launch Electron (only once!)
  electronProcess = spawn(npmCmd, ['run', 'dev:electron'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
  });

  electronProcess.on('exit', (code) => {
    console.log(`[SLC Desktop Runner] Electron app closed (code: ${code}).`);
    cleanup();
  });
});
