import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-load dev.ps1 config if present
function loadDevEnv() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const devPs1 = path.join(home, ".config", "slc", "dev.ps1");
  if (fs.existsSync(devPs1)) {
    try {
      const content = fs.readFileSync(devPs1, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(
          /^\$env:([A-Za-z0-9_]+)\s*=\s*['"]([^'"]+)['"]/,
        );
        if (match) {
          const [, key, val] = match;
          process.env[key] = val;
        }
      }
      console.log(
        "[SLC Desktop Runner] Loaded Gemini configuration from dev.ps1",
      );
    } catch {
      /* ignore */
    }
  }

  const devEnv = path.join(home, ".config", "slc", "dev.env");
  if (fs.existsSync(devEnv)) {
    try {
      const content = fs.readFileSync(devEnv, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(
          /^(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*['"]?([^'"]+)['"]?/,
        );
        if (match) {
          const [, key, val] = match;
          if (!process.env[key]) {
            process.env[key] = val.trim();
          }
        }
      }
      console.log("[SLC Desktop Runner] Loaded configuration from dev.env");
    } catch {
      /* ignore */
    }
  }

  // Ensure default models are set (gemini-3.5-flash-lite is active and tested)
  if (
    !process.env.SLC_GEMINI_MODEL ||
    process.env.SLC_GEMINI_MODEL.includes("2.5")
  ) {
    process.env.SLC_GEMINI_MODEL = "gemini-3.5-flash-lite";
  }
  if (
    !process.env.SLC_GEMINI_FALLBACK_MODEL ||
    process.env.SLC_GEMINI_FALLBACK_MODEL.includes("2.5")
  ) {
    process.env.SLC_GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
  }
}

loadDevEnv();

const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

console.log("[SLC Desktop Runner] Starting Vite dev server...");

// On POSIX, `shell: true` means the spawned PID is a shell/npm wrapper, not the
// real app. Starting each child as its own process-group leader (`detached`)
// lets us signal the whole group (wrapper + Vite/Electron + backend) later.
// On Windows we use `taskkill /T` instead, so `detached` is not needed.
const spawnOptions = {
  cwd: __dirname,
  stdio: "inherit",
  shell: true,
  detached: !isWindows,
};

// Terminate a child AND all of its descendants.
function killTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return;

  try {
    if (isWindows) {
      // /T = kill the whole tree, /F = force
      spawn("taskkill", ["/pid", child.pid.toString(), "/T", "/F"]);
    } else {
      // Negative PID = signal the entire process group created by `detached`
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

// 1. Start Vite dev server
const viteProcess = spawn(npmCmd, ["run", "dev"], spawnOptions);

let electronProcess = null;
let isShuttingDown = false;
let hasLaunchedElectron = false;

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n[SLC Desktop Runner] Shutting down all processes...");

  killTree(electronProcess);
  killTree(viteProcess);

  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

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

    req.on("error", () => {
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

  console.log(
    "[SLC Desktop Runner] Vite server is ready. Launching Electron App...",
  );

  // 3. Launch Electron (only once!)
  electronProcess = spawn(npmCmd, ["run", "dev:electron"], spawnOptions);

  electronProcess.on("exit", (code) => {
    console.log(`[SLC Desktop Runner] Electron app closed (code: ${code}).`);
    cleanup();
  });
});
