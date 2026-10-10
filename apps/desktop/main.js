import { app, BrowserWindow, session, desktopCapturer, screen, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

// Enable Wayland PipeWire capture flags on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WebRTCPipeWireCapturer');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let floatingWidget = null;
let currentSessionState = 'idle'; // 'idle' | 'monitoring' | 'paused'
let backendProcess = null;

// ==========================================
// 🔒 PRIVACY BY DESIGN: Security Token Setup
// ==========================================
const sessionToken = crypto.randomBytes(32).toString('hex');

function startBackendService() {
  if (process.env.SLC_DEV === '1') {
    console.log('[Electron Main] SLC_DEV=1 detected. Skipping automated backend spawning.');
    return;
  }

  const mockBackendPath = path.join(__dirname, 'mock-backend.js');
  console.log('[Electron Main] Spawning background orchestrator service...');

  backendProcess = spawn(process.execPath, [mockBackendPath], {
    env: {
      ...process.env,
      SLC_TOKEN: sessionToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend STDOUT] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend STDERR] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[Electron Main] Backend service exited (code: ${code}, signal: ${signal})`);
    backendProcess = null;
  });
}

function stopBackendService() {
  if (backendProcess) {
    console.log('[Electron Main] Terminating backend service on application shutdown...');
    try {
      backendProcess.kill('SIGTERM');
    } catch {
      backendProcess.kill();
    }
    backendProcess = null;
  }
}

// ==========================================
// 🪟 FRAMELESS FLOATING WIDGET (Zoom-style)
// ==========================================
function createFloatingWidget() {
  if (floatingWidget && !floatingWidget.isDestroyed()) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workArea;

  const widgetWidth = 340;
  const widgetHeight = 48;
  const margin = 24;

  floatingWidget = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: width - widgetWidth - margin,
    y: height - widgetHeight - margin,
    frame: false,
    transparent: false,
    backgroundColor: '#1c2128',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Security: Block any external navigation or popups from floating widget
  floatingWidget.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  floatingWidget.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://localhost:5173') {
      event.preventDefault();
      console.warn(`[Security] Blocked navigation from widget to: ${navigationUrl}`);
    }
  });

  floatingWidget.loadURL('http://localhost:5173/?view=floating');

  floatingWidget.webContents.on('did-finish-load', () => {
    floatingWidget?.webContents.send('sync-session-state', currentSessionState);
  });

  // If floating widget is closed directly, restore main window instead of quitting
  floatingWidget.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      restoreMainWindow();
    }
  });
}

function showFloatingWidget() {
  if (!floatingWidget || floatingWidget.isDestroyed()) {
    createFloatingWidget();
  }
  floatingWidget?.show();
  floatingWidget?.webContents.send('sync-session-state', currentSessionState);
}

function hideFloatingWidget() {
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.hide();
  }
}

function restoreMainWindow() {
  hideFloatingWidget();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

// IPC Handlers — strictly validate allowed actions and states (IPC sanitization)
const VALID_ACTIONS = new Set(['start', 'pause', 'resume', 'stop']);
const VALID_STATES = new Set(['idle', 'monitoring', 'paused']);

ipcMain.handle('get-current-session-state', () => currentSessionState);

ipcMain.on('session-state-changed', (_event, state) => {
  if (!VALID_STATES.has(state)) {
    console.warn(`[Security] Disallowed session state received: ${state}`);
    return;
  }
  currentSessionState = state;
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.webContents.send('sync-session-state', state);
  }
});

ipcMain.on('trigger-session-action', (_event, action) => {
  if (!VALID_ACTIONS.has(action)) {
    console.warn(`[Security] Disallowed session action received: ${action}`);
    return;
  }

  if (action === 'start') currentSessionState = 'monitoring';
  if (action === 'pause') currentSessionState = 'paused';
  if (action === 'resume') currentSessionState = 'monitoring';
  if (action === 'stop') currentSessionState = 'idle';

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session-action', action);
  }
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.webContents.send('sync-session-state', currentSessionState);
  }
});

ipcMain.on('restore-main-window', () => {
  restoreMainWindow();
});

ipcMain.on('minimize-to-widget', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  showFloatingWidget();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    backgroundColor: '#0e1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Security: Block popups and unauthorized external navigation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://localhost:5173') {
      event.preventDefault();
      console.warn(`[Security] Blocked unauthorized navigation to: ${navigationUrl}`);
    }
  });

  // When Vite is ready and mainWindow has loaded, pre-warm the floating widget
  mainWindow.webContents.on('did-finish-load', () => {
    createFloatingWidget();
  });

  // When user minimizes main window → hide it, show floating widget instead
  mainWindow.on('minimize', () => {
    // Use setImmediate so the minimize animation finishes before we hide
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      showFloatingWidget();
    });
  });

  // Intercept the close button: hide to tray widget instead of quitting
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      showFloatingWidget();
    }
  });

  mainWindow.loadURL('http://localhost:5173');
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0] });
        } else {
          callback({});
        }
      })
      .catch((err) => {
        console.error('[Screen Capture] Error retrieving sources:', err);
        callback({});
      });
  });

  startBackendService();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      restoreMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit — windows are hidden, not closed.
  // The app quits only via before-quit (e.g., from Task Manager or explicit quit).
  if (process.platform !== 'darwin') {
    // Only quit if ALL windows are actually destroyed (not just hidden)
    const allDestroyed = BrowserWindow.getAllWindows().every(w => w.isDestroyed());
    if (allDestroyed) app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.destroy();
  }
  stopBackendService();
});

process.on('exit', () => {
  stopBackendService();
});





