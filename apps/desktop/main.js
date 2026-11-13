import { app, BrowserWindow, session, desktopCapturer, screen, ipcMain, safeStorage } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';

// Enable Wayland PipeWire capture flags on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform,WebRTCPipeWireCapturer');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure single instance only — prevent duplicate windows/conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn('[Electron Main] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  restoreMainWindow();
});

let mainWindow = null;
let floatingWidget = null;
let isWidgetExpanded = false;
let savedMiniBounds = null;
let expandedInitialBounds = null;
let currentSessionState = 'idle'; // 'idle' | 'monitoring' | 'paused'
let backendProcess = null;

// ==========================================
// PRIVACY BY DESIGN: Security Token Setup
// ==========================================
const sessionToken = crypto.randomBytes(32).toString('hex');
const backendPort = process.env.SLC_PORT || '8100';
const mlPort = process.env.SLC_ML_PORT || '8200';

// ==========================================
// PRIVACY BY DESIGN: SQLCipher DB Key Setup
// ==========================================
function getOrCreateDatabaseKey() {
  const userDataDir = app.getPath('userData');
  const keyFilePath = path.join(userDataDir, 'slc_db.key');

  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    if (fs.existsSync(keyFilePath)) {
      const encryptedBuffer = fs.readFileSync(keyFilePath);
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(encryptedBuffer);
      } else {
        return encryptedBuffer.toString('utf8');
      }
    } else {
      const newKey = crypto.randomBytes(32).toString('hex');
      if (safeStorage.isEncryptionAvailable()) {
        const encryptedBuffer = safeStorage.encryptString(newKey);
        fs.writeFileSync(keyFilePath, encryptedBuffer);
      } else {
        console.warn('[Security] safeStorage encryption unavailable. Storing fallback key.');
        fs.writeFileSync(keyFilePath, newKey, 'utf8');
      }
      return newKey;
    }
  } catch (err) {
    console.error('[Security] Failed to manage encrypted DB key with safeStorage:', err);
    return crypto.randomBytes(32).toString('hex');
  }
}

async function notifyBackendSession(action) {
  const endpoint = action === 'start' || action === 'resume' ? '/session/start' : action === 'pause' ? '/session/pause' : '/session/stop';
  try {
    await fetch(`http://127.0.0.1:${backendPort}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Backend may still be initializing or running standalone in dev
  }
}

function startBackendService() {
  if (process.env.SLC_DEV === '1') {
    console.log('[Electron Main] SLC_DEV=1 detected. Skipping automated backend spawning.');
    return;
  }

  const dbKey = getOrCreateDatabaseKey();
  const orchestratorDir = path.resolve(__dirname, '../../services/orchestrator');
  const mlDir = path.resolve(__dirname, '../../services/ml');
  const mockBackendPath = path.join(__dirname, 'mock-backend.js');
  const hasOrchestrator = fs.existsSync(path.join(orchestratorDir, 'Slc.Orchestrator.csproj'));
  const forceMock = process.env.SLC_USE_MOCK === '1';

  const env = {
    ...process.env,
    SLC_TOKEN: sessionToken,
    SLC_PORT: String(backendPort),
    SLC_ML_PORT: String(mlPort),
    SLC_DATA_DIR: app.getPath('userData'),
    SLC_DB_KEY: dbKey,
    SLC_ML_DIR: mlDir,
    SLC_GEMINI_MODEL: (process.env.SLC_GEMINI_MODEL && !process.env.SLC_GEMINI_MODEL.includes('2.5')) ? process.env.SLC_GEMINI_MODEL : 'gemini-3.5-flash-lite',
    SLC_GEMINI_FALLBACK_MODEL: (process.env.SLC_GEMINI_FALLBACK_MODEL && !process.env.SLC_GEMINI_FALLBACK_MODEL.includes('2.5')) ? process.env.SLC_GEMINI_FALLBACK_MODEL : 'gemini-3.1-flash-lite',
  };

  function spawnMock(reason) {
    if (backendProcess && !backendProcess.killed) {
      try { backendProcess.kill(); } catch { /* ignore */ }
      backendProcess = null;
    }
    console.log(`[Electron Main] ${reason ? `[${reason}] ` : ''}Spawning contract mock backend service (127.0.0.1:${backendPort})...`);
    backendProcess = spawn(process.execPath, [mockBackendPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    wireProcess(backendProcess);
  }

  function wireProcess(proc) {
    proc.stdout?.on('data', (data) => {
      console.log(`[Backend STDOUT] ${data.toString().trim()}`);
    });

    proc.stderr?.on('data', (data) => {
      console.error(`[Backend STDERR] ${data.toString().trim()}`);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[Electron Main] Backend service exited (code: ${code}, signal: ${signal})`);
      backendProcess = null;
    });
  }

  if (!forceMock && hasOrchestrator) {
    console.log(`[Electron Main] Spawning .NET orchestrator service (127.0.0.1:${backendPort})...`);
    let isAlive = false;
    try {
      backendProcess = spawn('dotnet', ['run', '--project', orchestratorDir], {
        cwd: orchestratorDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      wireProcess(backendProcess);

      const startupTimer = setTimeout(() => {
        isAlive = true;
      }, 3000);

      backendProcess.on('error', (err) => {
        clearTimeout(startupTimer);
        console.warn(`[Electron Main] Dotnet launch error: ${err.message}. Falling back to mock backend.`);
        spawnMock('Fallback from dotnet execution error');
      });

      backendProcess.once('exit', (code) => {
        clearTimeout(startupTimer);
        if (!isAlive && code !== 0) {
          console.warn(`[Electron Main] .NET orchestrator failed to start (exit code: ${code}). Falling back to local mock backend for unblocked UI development.`);
          spawnMock('Fallback from failed .NET startup');
        }
      });
    } catch (err) {
      console.warn(`[Electron Main] Could not launch dotnet executable: ${err.message}. Falling back to mock backend.`);
      spawnMock('Fallback from dotnet execution error');
    }
  } else {
    spawnMock(forceMock ? 'SLC_USE_MOCK=1 requested' : 'Orchestrator csproj not found');
  }
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
// FRAMELESS FLOATING WIDGET (Zoom-style)
// ==========================================
function createFloatingWidget() {
  if (floatingWidget && !floatingWidget.isDestroyed()) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workArea;

  const widgetWidth = 400;
  const widgetHeight = 44;
  const margin = 24;

  const initialX = savedMiniBounds?.x ?? (width - widgetWidth - margin);
  const initialY = savedMiniBounds?.y ?? (height - widgetHeight - margin);
  savedMiniBounds = { x: initialX, y: initialY };
  isWidgetExpanded = false;

  floatingWidget = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: initialX,
    y: initialY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatingWidget.setBackgroundColor('#00000000');
  floatingWidget.setAlwaysOnTop(true, 'floating');
  try {
    floatingWidget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch { /* platform specific */ }

  // Track user dragging the collapsed mini bar so we always preserve their chosen spot
  floatingWidget.on('move', () => {
    if (!isWidgetExpanded && floatingWidget && !floatingWidget.isDestroyed()) {
      const b = floatingWidget.getBounds();
      savedMiniBounds = { x: b.x, y: b.y };
    }
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
  floatingWidget?.setAlwaysOnTop(true, 'floating');
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
  const action = state === 'monitoring' ? 'start' : state === 'paused' ? 'pause' : 'stop';
  notifyBackendSession(action);
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

  notifyBackendSession(action);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session-action', action);
  }
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.webContents.send('sync-session-state', currentSessionState);
  }
});

// Contract context.md: POST raw JPEG bytes to /context/frame
ipcMain.handle('send-frame-context', async (_event, { frameBuffer, requestId, wait }) => {
  try {
    const url = wait
      ? `http://127.0.0.1:${backendPort}/context/frame?wait=true`
      : `http://127.0.0.1:${backendPort}/context/frame`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'image/jpeg',
        'X-Request-Id': requestId || `req_${Date.now()}`,
      },
      body: Buffer.from(frameBuffer),
    });

    let data = null;
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      }
      return { success: true, status: res.status, data };
    }
    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error('[Electron Main] Failed to dispatch frame context to backend:', err);
    return { success: false, error: err.message };
  }
});

// Provide backend port and in-memory auth token to Renderer for SignalR hub connection
ipcMain.handle('get-backend-config', () => ({
  port: backendPort,
  token: sessionToken,
}));

// Contract session-and-help.md: POST /alerts/{id}/response
ipcMain.handle('send-alert-response', async (_event, { alertId, accepted }) => {
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/alerts/${encodeURIComponent(alertId)}/response`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accepted }),
    });
    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error('[Electron Main] Failed to dispatch alert response to backend:', err);
    return { success: false, error: err.message };
  }
});

// Contract session-and-help.md: POST /help/now (Triggers captureRequest over SignalR)
ipcMain.handle('trigger-help-now', async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/help/now`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error('[Electron Main] Failed to trigger /help/now:', err);
    return { success: false, error: err.message };
  }
});

// Diagnostic: Print explanation to terminal & forward to floating widget
ipcMain.on('log-explanation', (_event, data) => {
  console.log('\n==================== [AI TUTOR EXPLANATION] ====================');
  console.log(`Language : ${data.language || 'si'}`);
  console.log(`RequestID: ${data.requestId}`);
  console.log('-------------------------------------------------------------------');
  console.log(data.text);
  console.log('===================================================================\n');

  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.show();
    floatingWidget.setAlwaysOnTop(true, 'floating');
    floatingWidget.webContents.send('new-explanation', data);
  }
});

// Floating Side Overlay Chat Controls (Smart Position Preserving)
ipcMain.on('resize-widget', (_event, expanded) => {
  if (!floatingWidget || floatingWidget.isDestroyed()) return;
  const bounds = floatingWidget.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workArea;

  const widgetWidth = 400;
  const widgetHeight = 44;
  const chatWidth = 420;
  const chatHeight = Math.min(650, screenHeight - 60);

  if (expanded) {
    isWidgetExpanded = true;
    // Always snapshot the exact mini bar position immediately prior to expanding
    savedMiniBounds = { x: bounds.x, y: bounds.y };

    // Anchor to mini bar: align right edges so chat extends naturally
    let x = bounds.x + bounds.width - chatWidth;
    // If mini bar is in lower half of screen, expand upwards from its bottom edge
    let y = (bounds.y + bounds.height > screenHeight / 2)
      ? (bounds.y + bounds.height - chatHeight)
      : bounds.y;

    // Bounds checking
    if (x + chatWidth > screenWidth - 16) x = screenWidth - chatWidth - 16;
    if (y + chatHeight > screenHeight - 16) y = screenHeight - chatHeight - 16;
    if (x < 16) x = 16;
    if (y < 16) y = 16;

    expandedInitialBounds = { x: Math.round(x), y: Math.round(y) };

    floatingWidget.setBounds({
      x: expandedInitialBounds.x,
      y: expandedInitialBounds.y,
      width: chatWidth,
      height: chatHeight,
    });
    floatingWidget.setAlwaysOnTop(true, 'floating');
  } else {
    isWidgetExpanded = false;
    let targetX;
    let targetY;

    // Check if the user manually dragged the chat drawer while it was open
    const userMovedChat = expandedInitialBounds && (
      Math.abs(bounds.x - expandedInitialBounds.x) > 10 ||
      Math.abs(bounds.y - expandedInitialBounds.y) > 10
    );

    if (userMovedChat) {
      // If user moved the chat, collapse near where they left the chat
      targetX = bounds.x + bounds.width - widgetWidth;
      targetY = (bounds.y + bounds.height > screenHeight / 2)
        ? (bounds.y + bounds.height - widgetHeight)
        : bounds.y;
    } else if (savedMiniBounds) {
      // User did not drag chat: Restore exactly to where the user dragged the mini bar!
      targetX = savedMiniBounds.x;
      targetY = savedMiniBounds.y;
    } else {
      targetX = bounds.x;
      targetY = bounds.y;
    }

    // Keep within screen work area
    if (targetX + widgetWidth > screenWidth - 16) targetX = screenWidth - widgetWidth - 16;
    if (targetY + widgetHeight > screenHeight - 16) targetY = screenHeight - widgetHeight - 16;
    if (targetX < 16) targetX = 16;
    if (targetY < 16) targetY = 16;

    savedMiniBounds = { x: Math.round(targetX), y: Math.round(targetY) };

    floatingWidget.setBounds({
      x: savedMiniBounds.x,
      y: savedMiniBounds.y,
      width: widgetWidth,
      height: widgetHeight,
    });
    floatingWidget.setAlwaysOnTop(true, 'floating');
  }
});

ipcMain.on('request-screen-capture', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('request-screen-capture');
  }
});

ipcMain.handle('send-chat-message', async (_event, { history, message, contextText }) => {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.SLC_GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const fallbackModel = process.env.SLC_GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';

  if (!key) {
    return { success: false, error: 'GEMINI_API_KEY is not configured.' };
  }

  const systemPrompt = `You are a patient, encouraging, and clear AI Tutor assisting a university student studying computer science and technology.
The student is interacting with you in a side-overlay live chat companion.
Explain concepts in natural, conversational Sinhala (or English if the student asks in English).
CRITICAL RULE: Always keep English technical terms (such as function, array, recursion, API, database, async, loop, bug, exception, etc.) in English script without transliterating them into Sinhala script, but explain their meaning in Sinhala.
Be concise, helpful, and provide short code examples where helpful.
${contextText ? `\n[Context from Student's Screen]:\n${contextText}\n` : ''}`;

  const contents = (history || []).map((h) => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));

  contents.push({
    role: 'user',
    parts: [{ text: message }],
  });

  async function callGemini(selectedModel) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const reply = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error('No reply generated by Gemini');
    return reply;
  }

  try {
    const reply = await callGemini(model);
    return { success: true, reply };
  } catch (err) {
    console.warn(`[Chat] Primary model ${model} failed: ${err.message}. Trying fallback ${fallbackModel}...`);
    try {
      const reply = await callGemini(fallbackModel);
      return { success: true, reply };
    } catch (fallbackErr) {
      console.error('[Chat] Both models failed:', fallbackErr);
      return { success: false, error: fallbackErr.message };
    }
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

  // Forward renderer console logs directly to terminal stdout
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[Renderer UI] ${message}`);
  });

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

  const loadApp = () => {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          loadApp();
        }
      }, 500);
    });
  };
  loadApp();
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





