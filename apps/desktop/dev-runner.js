import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 [SLC Launcher] Starting Vite frontend dev server...');

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

const viteProcess = spawn(npxCmd, ['vite'], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

viteProcess.stdout?.on('data', (data) => {
  const line = data.toString();
  if (line.includes('Local:') || line.includes('ready in')) {
    process.stdout.write(`[Vite] ${line}`);
  }
});

viteProcess.stderr?.on('data', (data) => {
  process.stderr.write(`[Vite Error] ${data.toString()}`);
});

let electronStarted = false;

function pollVite(retries = 40) {
  if (retries <= 0) {
    console.error('❌ [SLC Launcher] Vite failed to respond in time.');
    try { viteProcess.kill(); } catch {}
    process.exit(1);
  }

  const req = http.get('http://localhost:5173', (res) => {
    if (!electronStarted) {
      electronStarted = true;
      console.log('✅ [SLC Launcher] Vite is ready! Launching Electron desktop app...');
      console.log('⚡ [SLC Launcher] Electron will automatically boot .NET Orchestrator & Python ML backend.');
      launchElectron();
    }
  });

  req.on('error', () => {
    setTimeout(() => pollVite(retries - 1), 300);
  });
}

function launchElectron() {
  const electronProcess = spawn(npxCmd, ['electron', '.'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
  });

  electronProcess.on('exit', (code) => {
    console.log('🛑 [SLC Launcher] Electron desktop app closed. Terminating Vite...');
    try {
      viteProcess.kill('SIGTERM');
    } catch {
      viteProcess.kill();
    }
    process.exit(code || 0);
  });
}

pollVite();

