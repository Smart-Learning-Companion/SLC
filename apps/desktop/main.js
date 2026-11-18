import {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  screen,
  ipcMain,
  safeStorage,
} from "electron";
import { fileURLToPath } from "url";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { spawn } from "child_process";

// Platform flags. Native Wayland is the default on Linux; set SLC_FORCE_X11=1
// to fall back to XWayland for comparison (screen capture is limited there).
const IS_LINUX = process.platform === "linux";
const FORCE_X11 = IS_LINUX && process.env.SLC_FORCE_X11 === "1";
const IS_WAYLAND = IS_LINUX && !FORCE_X11;

if (IS_LINUX) {
  // Keep the Wayland app_id stable and matchable by compositor rules.
  app.setDesktopName("com.smartlearningcompanion.slc");
  app.commandLine.appendSwitch(
    "enable-features",
    "UseOzonePlatform,WebRTCPipeWireCapturer",
  );
  app.commandLine.appendSwitch("ozone-platform", FORCE_X11 ? "x11" : "wayland");
  console.log(
    `[Electron Main] Linux Ozone platform: ${FORCE_X11 ? "x11 (XWayland)" : "wayland"}`,
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure single instance only — prevent duplicate windows/conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn(
    "[Electron Main] Another instance is already running. Quitting.",
  );
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  restoreMainWindow();
});

let mainWindow = null;
let floatingWidget = null;
let chatWindow = null;
let isWidgetExpanded = false;
let savedMiniBounds = null;
let currentSessionState = "idle"; // 'idle' | 'monitoring' | 'paused'
let backendProcess = null;

// Initial widget size only. The renderer measures its real content and the
// window is resized to match (see 'fit-widget'), so nothing is cut off.
const MINI_WIDGET_WIDTH = 560;
const MINI_WIDGET_HEIGHT = 44;
const MINI_WIDGET_MIN_WIDTH = 160;
const SCREEN_MARGIN = 16;

const clamp = (value, lo, hi) =>
  Math.min(Math.max(value, lo), Math.max(lo, hi));

// Wayland ignores x/y and clients cannot read global coordinates, so every size
// is derived from the display instead of fixed numbers.
function getWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function computeChatSize() {
  const { width, height } = getWorkArea();
  const maxW = width - SCREEN_MARGIN * 2;
  const maxH = height - SCREEN_MARGIN * 2;
  return {
    width: Math.round(
      clamp(width * 0.42, Math.min(420, maxW), Math.min(800, maxW)),
    ),
    // 0.82 leaves room for a status bar the compositor may not report as reserved.
    height: Math.round(
      clamp(height * 0.82, Math.min(480, maxH), Math.min(900, maxH)),
    ),
  };
}

function computeDashboardSize() {
  const { width, height } = getWorkArea();
  return {
    width: Math.round(Math.min(1100, width * 0.9)),
    height: Math.round(Math.min(750, height * 0.88)),
  };
}

// Resize a deliberately fixed-size window. min/max are kept equal to the size we
// ask for so the compositor never sees constraints that contradict it.
function applyFixedSize(win, width, height) {
  if (!win || win.isDestroyed()) return;
  const w = Math.round(width);
  const h = Math.round(height);
  const [curW, curH] = win.getContentSize();
  const [minW, minH] = win.getMinimumSize();
  const [maxW, maxH] = win.getMaximumSize();
  if (
    curW === w &&
    curH === h &&
    minW === w &&
    minH === h &&
    maxW === w &&
    maxH === h
  )
    return;
  win.setMinimumSize(1, 1);
  win.setMaximumSize(0, 0); // 0 = unbounded
  win.setContentSize(w, h);
  win.setMinimumSize(w, h);
  win.setMaximumSize(w, h);
}

// X11-only hints (always-on-top level, all workspaces). They are no-ops on
// Wayland, where the Hyprland rules (float / pin) do this job instead.
function applyOverlayHints(win) {
  if (IS_WAYLAND || !win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, "screen-saver");
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* platform specific */
  }
}

function sendOverlayMessage(channel, ...args) {
  for (const window of [floatingWidget, chatWindow]) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  }
}

function preserveNativeTitle(window, title) {
  window.setTitle(title);
  window.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
}

// ==========================================
// PRIVACY BY DESIGN: Security Token Setup
// ==========================================
const sessionToken = crypto.randomBytes(32).toString("hex");
const backendPort = process.env.SLC_PORT || "8100";
const mlPort = process.env.SLC_ML_PORT || "8200";

// ==========================================
// PRIVACY BY DESIGN: SQLCipher DB Key Setup
// ==========================================
function getOrCreateDatabaseKey() {
  const userDataDir = app.getPath("userData");
  const keyFilePath = path.join(userDataDir, "slc_db.key");

  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    if (fs.existsSync(keyFilePath)) {
      const encryptedBuffer = fs.readFileSync(keyFilePath);
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(encryptedBuffer);
      } else {
        return encryptedBuffer.toString("utf8");
      }
    } else {
      const newKey = crypto.randomBytes(32).toString("hex");
      if (safeStorage.isEncryptionAvailable()) {
        const encryptedBuffer = safeStorage.encryptString(newKey);
        fs.writeFileSync(keyFilePath, encryptedBuffer);
      } else {
        console.warn(
          "[Security] safeStorage encryption unavailable. Storing fallback key.",
        );
        fs.writeFileSync(keyFilePath, newKey, "utf8");
      }
      return newKey;
    }
  } catch (err) {
    console.error(
      "[Security] Failed to manage encrypted DB key with safeStorage:",
      err,
    );
    return crypto.randomBytes(32).toString("hex");
  }
}

async function notifyBackendSession(action) {
  const endpoint =
    action === "start" || action === "resume"
      ? "/session/start"
      : action === "pause"
        ? "/session/pause"
        : "/session/stop";
  try {
    await fetch(`http://127.0.0.1:${backendPort}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Backend may still be initializing or running standalone in dev
  }
}

function startBackendService() {
  if (process.env.SLC_DEV === "1") {
    console.log(
      "[Electron Main] SLC_DEV=1 detected. Skipping automated backend spawning.",
    );
    return;
  }

  const dbKey = getOrCreateDatabaseKey();
  const orchestratorDir = path.resolve(
    __dirname,
    "../../services/orchestrator",
  );
  const mlDir = path.resolve(__dirname, "../../services/ml");
  const mockBackendPath = path.join(__dirname, "mock-backend.js");
  const hasOrchestrator = fs.existsSync(
    path.join(orchestratorDir, "Slc.Orchestrator.csproj"),
  );
  const forceMock = process.env.SLC_USE_MOCK === "1";

  const env = {
    ...process.env,
    SLC_TOKEN: sessionToken,
    SLC_PORT: String(backendPort),
    SLC_ML_PORT: String(mlPort),
    SLC_DATA_DIR: app.getPath("userData"),
    SLC_DB_KEY: dbKey,
    SLC_ML_DIR: mlDir,
    SLC_GEMINI_MODEL:
      process.env.SLC_GEMINI_MODEL &&
      !process.env.SLC_GEMINI_MODEL.includes("2.5")
        ? process.env.SLC_GEMINI_MODEL
        : "gemini-3.5-flash-lite",
    SLC_GEMINI_FALLBACK_MODEL:
      process.env.SLC_GEMINI_FALLBACK_MODEL &&
      !process.env.SLC_GEMINI_FALLBACK_MODEL.includes("2.5")
        ? process.env.SLC_GEMINI_FALLBACK_MODEL
        : "gemini-3.1-flash-lite",
  };

  function spawnMock(reason) {
    if (backendProcess && !backendProcess.killed) {
      try {
        backendProcess.kill();
      } catch {
        /* ignore */
      }
      backendProcess = null;
    }
    console.log(
      `[Electron Main] ${reason ? `[${reason}] ` : ""}Spawning contract mock backend service (127.0.0.1:${backendPort})...`,
    );
    backendProcess = spawn(process.execPath, [mockBackendPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    wireProcess(backendProcess);
  }

  function wireProcess(proc) {
    proc.stdout?.on("data", (data) => {
      console.log(`[Backend STDOUT] ${data.toString().trim()}`);
    });

    proc.stderr?.on("data", (data) => {
      console.error(`[Backend STDERR] ${data.toString().trim()}`);
    });

    proc.on("exit", (code, signal) => {
      console.log(
        `[Electron Main] Backend service exited (code: ${code}, signal: ${signal})`,
      );
      backendProcess = null;
    });
  }

  if (!forceMock && hasOrchestrator) {
    console.log(
      `[Electron Main] Spawning .NET orchestrator service (127.0.0.1:${backendPort})...`,
    );
    let isAlive = false;
    try {
      backendProcess = spawn("dotnet", ["run", "--project", orchestratorDir], {
        cwd: orchestratorDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      wireProcess(backendProcess);

      const startupTimer = setTimeout(() => {
        isAlive = true;
      }, 3000);

      backendProcess.on("error", (err) => {
        clearTimeout(startupTimer);
        console.warn(
          `[Electron Main] Dotnet launch error: ${err.message}. Falling back to mock backend.`,
        );
        spawnMock("Fallback from dotnet execution error");
      });

      backendProcess.once("exit", (code) => {
        clearTimeout(startupTimer);
        if (!isAlive && code !== 0) {
          console.warn(
            `[Electron Main] .NET orchestrator failed to start (exit code: ${code}). Falling back to local mock backend for unblocked UI development.`,
          );
          spawnMock("Fallback from failed .NET startup");
        }
      });
    } catch (err) {
      console.warn(
        `[Electron Main] Could not launch dotnet executable: ${err.message}. Falling back to mock backend.`,
      );
      spawnMock("Fallback from dotnet execution error");
    }
  } else {
    spawnMock(
      forceMock ? "SLC_USE_MOCK=1 requested" : "Orchestrator csproj not found",
    );
  }
}

function stopBackendService() {
  if (backendProcess) {
    console.log(
      "[Electron Main] Terminating backend service on application shutdown...",
    );
    try {
      backendProcess.kill("SIGTERM");
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

  const { x: workAreaX, y: workAreaY, width, height } = getWorkArea();
  const margin = 24;
  isWidgetExpanded = false;

  // x/y only matter off-Wayland; on Hyprland the window rule places the widget.
  const position = IS_WAYLAND
    ? {}
    : {
        x: savedMiniBounds?.x ?? workAreaX + width - MINI_WIDGET_WIDTH - margin,
        y:
          savedMiniBounds?.y ??
          workAreaY + height - MINI_WIDGET_HEIGHT - margin,
      };
  if (!IS_WAYLAND) savedMiniBounds = { x: position.x, y: position.y };

  floatingWidget = new BrowserWindow({
    title: "SLC Floating Widget",
    width: MINI_WIDGET_WIDTH,
    height: MINI_WIDGET_HEIGHT,
    ...position,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    roundedCorners: true,
    useContentSize: true,
    ...(FORCE_X11 ? { type: "toolbar", alwaysOnTop: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  preserveNativeTitle(floatingWidget, "SLC Floating Widget");

  floatingWidget.setBackgroundColor("#00000000");
  applyOverlayHints(floatingWidget);

  // Track user dragging the collapsed mini bar so we always preserve their chosen spot
  floatingWidget.on("move", () => {
    // Wayland never reports real global coordinates, so only track elsewhere.
    if (
      !IS_WAYLAND &&
      !isWidgetExpanded &&
      floatingWidget &&
      !floatingWidget.isDestroyed()
    ) {
      const b = floatingWidget.getBounds();
      savedMiniBounds = { x: b.x, y: b.y };
    }
  });

  // Security: Block any external navigation or popups from floating widget
  floatingWidget.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  floatingWidget.webContents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== "http://localhost:5173") {
      event.preventDefault();
      console.warn(
        `[Security] Blocked navigation from widget to: ${navigationUrl}`,
      );
    }
  });

  floatingWidget.loadURL("http://localhost:5173/?view=floating");

  floatingWidget.webContents.on("did-finish-load", () => {
    floatingWidget?.webContents.send("sync-session-state", currentSessionState);
  });

  // If floating widget is closed directly, restore main window instead of quitting
  floatingWidget.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      restoreMainWindow();
    }
  });
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) return;

  const { width: chatWidth, height: chatHeight } = computeChatSize();
  const {
    x: workAreaX,
    y: workAreaY,
    width: screenWidth,
    height: screenHeight,
  } = getWorkArea();

  // x/y only matter off-Wayland; on Hyprland the window rule centers the overlay.
  const position = IS_WAYLAND
    ? {}
    : {
        x: Math.round(
          Math.max(
            workAreaX + SCREEN_MARGIN,
            Math.min(
              (savedMiniBounds?.x ??
                workAreaX + screenWidth - MINI_WIDGET_WIDTH - 24) +
                MINI_WIDGET_WIDTH -
                chatWidth,
              workAreaX + screenWidth - chatWidth - SCREEN_MARGIN,
            ),
          ),
        ),
        y: Math.round(
          Math.max(
            workAreaY + SCREEN_MARGIN,
            Math.min(
              (savedMiniBounds?.y ??
                workAreaY + screenHeight - MINI_WIDGET_HEIGHT - 24) +
                MINI_WIDGET_HEIGHT -
                chatHeight,
              workAreaY + screenHeight - chatHeight - SCREEN_MARGIN,
            ),
          ),
        ),
      };

  chatWindow = new BrowserWindow({
    title: "SLC Chat Overlay",
    width: chatWidth,
    height: chatHeight,
    ...position,
    frame: false,
    // Transparent so the rounded, semi-transparent glass panel in the CSS does
    // not sit on an opaque rectangle (that caused the square corner artifacts).
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    roundedCorners: true,
    useContentSize: true,
    ...(FORCE_X11 ? { type: "toolbar", alwaysOnTop: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Lock the size to what we computed (min = max = size) so Electron and the
  // compositor agree. Re-applied on every open and on display changes.
  applyFixedSize(chatWindow, chatWidth, chatHeight);

  chatWindow.setBackgroundColor("#00000000");
  applyOverlayHints(chatWindow);
  preserveNativeTitle(chatWindow, "SLC Chat Overlay");
  chatWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  chatWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== "http://localhost:5173") {
      event.preventDefault();
      console.warn(
        `[Security] Blocked navigation from chat to: ${navigationUrl}`,
      );
    }
  });
  chatWindow.webContents.on("did-finish-load", () => {
    sendOverlayMessage("sync-session-state", currentSessionState);
  });
  chatWindow.loadURL("http://localhost:5173/?view=floating&mode=chat");

  chatWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      closeChatWindow();
    }
  });
}

function showFloatingWidget() {
  isWidgetExpanded = false;
  if (!floatingWidget || floatingWidget.isDestroyed()) {
    createFloatingWidget();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.hide();
  }
  // showInactive: the always-visible widget must never steal keyboard focus.
  floatingWidget?.showInactive();
  applyOverlayHints(floatingWidget);
  floatingWidget?.webContents.send("sync-session-state", currentSessionState);
}

function openChatWindow() {
  isWidgetExpanded = true;
  if (!chatWindow || chatWindow.isDestroyed()) {
    createChatWindow();
  }
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.hide();
  }
  // The display may have changed since the window was created.
  const chatSize = computeChatSize();
  applyFixedSize(chatWindow, chatSize.width, chatSize.height);
  chatWindow?.show();
  chatWindow?.focus();
  applyOverlayHints(chatWindow);
  chatWindow?.webContents.send("sync-session-state", currentSessionState);
}

function closeChatWindow() {
  isWidgetExpanded = false;
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.hide();
  }
  showFloatingWidget();
}

function hideFloatingWidget() {
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.hide();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.hide();
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
const VALID_ACTIONS = new Set(["start", "pause", "resume", "stop"]);
const VALID_STATES = new Set(["idle", "monitoring", "paused"]);

ipcMain.handle("get-current-session-state", () => currentSessionState);

ipcMain.on("session-state-changed", (_event, state) => {
  if (!VALID_STATES.has(state)) {
    console.warn(`[Security] Disallowed session state received: ${state}`);
    return;
  }
  currentSessionState = state;
  const action =
    state === "monitoring" ? "start" : state === "paused" ? "pause" : "stop";
  notifyBackendSession(action);
  sendOverlayMessage("sync-session-state", state);
});

ipcMain.on("trigger-session-action", (_event, action) => {
  if (!VALID_ACTIONS.has(action)) {
    console.warn(`[Security] Disallowed session action received: ${action}`);
    return;
  }

  if (action === "start") currentSessionState = "monitoring";
  if (action === "pause") currentSessionState = "paused";
  if (action === "resume") currentSessionState = "monitoring";
  if (action === "stop") currentSessionState = "idle";

  notifyBackendSession(action);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("session-action", action);
  }
  sendOverlayMessage("sync-session-state", currentSessionState);
});

// Contract context.md: POST raw JPEG bytes to /context/frame
ipcMain.handle(
  "send-frame-context",
  async (_event, { frameBuffer, requestId, wait }) => {
    try {
      const url = wait
        ? `http://127.0.0.1:${backendPort}/context/frame?wait=true`
        : `http://127.0.0.1:${backendPort}/context/frame`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "image/jpeg",
          "X-Request-Id": requestId || `req_${Date.now()}`,
        },
        body: Buffer.from(frameBuffer),
      });

      let data = null;
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          data = await res.json();
        }
        return { success: true, status: res.status, data };
      }
      return { success: res.ok, status: res.status };
    } catch (err) {
      console.error(
        "[Electron Main] Failed to dispatch frame context to backend:",
        err,
      );
      return { success: false, error: err.message };
    }
  },
);

// Provide backend port and in-memory auth token to Renderer for SignalR hub connection
ipcMain.handle("get-backend-config", () => ({
  port: backendPort,
  token: sessionToken,
}));

// Contract session-and-help.md: POST /alerts/{id}/response
ipcMain.handle("send-alert-response", async (_event, { alertId, accepted }) => {
  try {
    const res = await fetch(
      `http://127.0.0.1:${backendPort}/alerts/${encodeURIComponent(alertId)}/response`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accepted }),
      },
    );
    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error(
      "[Electron Main] Failed to dispatch alert response to backend:",
      err,
    );
    return { success: false, error: err.message };
  }
});

// Contract session-and-help.md: POST /help/now (Triggers captureRequest over SignalR)
ipcMain.handle("trigger-help-now", async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/help/now`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error("[Electron Main] Failed to trigger /help/now:", err);
    return { success: false, error: err.message };
  }
});

// Diagnostic: Print explanation to terminal & forward to floating widget
ipcMain.on("log-explanation", (_event, data) => {
  console.log(
    "\n==================== [AI TUTOR EXPLANATION] ====================",
  );
  console.log(`Language : ${data.language || "si"}`);
  console.log(`RequestID: ${data.requestId}`);
  console.log(
    "-------------------------------------------------------------------",
  );
  console.log(data.text);
  console.log(
    "===================================================================\n",
  );

  openChatWindow();
  sendOverlayMessage("new-explanation", data);
});

// Floating Side Overlay Chat Controls. Wayland uses separate fixed-size
// surfaces; opening chat never resizes or reuses the widget surface.
ipcMain.on("open-chat-window", openChatWindow);
ipcMain.on("close-chat-window", closeChatWindow);

ipcMain.on("request-screen-capture", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("request-screen-capture");
  }
});

ipcMain.handle(
  "send-chat-message",
  async (_event, { history, message, contextText }) => {
    const key = process.env.GEMINI_API_KEY;
    const model = process.env.SLC_GEMINI_MODEL || "gemini-3.5-flash-lite";
    const fallbackModel =
      process.env.SLC_GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";

    if (!key) {
      return { success: false, error: "GEMINI_API_KEY is not configured." };
    }

    const systemPrompt = `You are a versatile, highly knowledgeable, and patient academic AI Tutor assisting university students across any field of study.
The student interacts with you in a live companion window while studying or working on their computer.
${contextText ? `\n[Context from Student's Current Screen]:\n${contextText}\n` : ""}

CORE PRINCIPLES:
1. UNIVERSAL SUBJECT EXPERTISE:
   - Dynamically adapt to the student's field based on their screen context and query (e.g., Engineering, Natural Sciences, Medicine, Humanities, Law, Business, Computer Science, or University Documents).
   - Maintain strict domain accuracy: never bias an inquiry toward Computer Science or any specific field unless the screen or question is genuinely about that field.

2. MULTILINGUAL & COLLOQUIAL INTENT UNDERSTANDING:
   - Students may query in standard English, native Sinhala script, or colloquial Latin-scripted Sinhala (Singlish).
   - Accurately interpret the underlying conversational Sinhala meaning of Latin-scripted queries. Never confuse phonetically written Sinhala words with similarly spelled English technical jargon.
   - Reply in clear, natural, and encouraging Sinhala (or in English if the student asks in English).

3. PRESERVATION OF TECHNICAL TERMINOLOGY:
   - Keep all technical, domain-specific, scientific, and academic terms in standard English script (ASCII).
   - Never transliterate English technical words into phonetic Sinhala letters.
   - Clearly explain the meaning and practical significance of every technical term in Sinhala.

4. PEDAGOGICAL STRUCTURE & MARKDOWN FORMATTING:
   - Provide clear, thorough, and well-structured explanations using GitHub-flavored Markdown.
   - Use bold highlights, bulleted lists, and structured sections (Overview, Detailed Breakdown, Practical Application / Next Steps).
   - When discussing code (only if the topic is genuinely programming), use formatted code blocks with syntax highlighting language tags.

TONE:
Supportive, intellectually rigorous, patient, and pedagogically clear.`;

    const contents = (history || []).map((h) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text }],
    }));

    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    async function callGemini(selectedModel) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 2048,
            },
          }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
      }

      const json = await res.json();
      const reply = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply) throw new Error("No reply generated by Gemini");
      return reply;
    }

    try {
      const reply = await callGemini(model);
      return { success: true, reply };
    } catch (err) {
      console.warn(
        `[Chat] Primary model ${model} failed: ${err.message}. Trying fallback ${fallbackModel}...`,
      );
      try {
        const reply = await callGemini(fallbackModel);
        return { success: true, reply };
      } catch (fallbackErr) {
        console.error("[Chat] Both models failed:", fallbackErr);
        return { success: false, error: fallbackErr.message };
      }
    }
  },
);

// The widget renderer measures its natural size and asks for a matching window,
// so labels/buttons are never cut off and no pixel size lives in Hyprland rules.
ipcMain.on("fit-widget", (event, size) => {
  if (!floatingWidget || floatingWidget.isDestroyed()) return;
  if (event.sender !== floatingWidget.webContents) return;
  const w = Number(size?.width);
  const h = Number(size?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  const { width: areaW } = getWorkArea();
  applyFixedSize(
    floatingWidget,
    clamp(Math.ceil(w), MINI_WIDGET_MIN_WIDTH, areaW - SCREEN_MARGIN * 2),
    clamp(Math.ceil(h), 28, 120),
  );
});

ipcMain.on("restore-main-window", () => {
  restoreMainWindow();
});

ipcMain.on("minimize-to-widget", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  showFloatingWidget();
});

function createWindow() {
  // Sized from the display so it fits small screens. Floating is handled by the
  // Hyprland window rule (initial_title), not by X11-only window types.
  const { width: dashWidth, height: dashHeight } = computeDashboardSize();

  mainWindow = new BrowserWindow({
    title: "SLC Dashboard",
    width: dashWidth,
    height: dashHeight,
    minWidth: Math.min(640, dashWidth),
    minHeight: Math.min(480, dashHeight),
    backgroundColor: "#0e1117",
    useContentSize: true,
    ...(FORCE_X11 ? { type: "utility" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  preserveNativeTitle(mainWindow, "SLC Dashboard");

  // Security: Block popups and unauthorized external navigation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Forward renderer console logs directly to terminal stdout
  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    console.log(`[Renderer UI] ${message}`);
  });

  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== "http://localhost:5173") {
      event.preventDefault();
      console.warn(
        `[Security] Blocked unauthorized navigation to: ${navigationUrl}`,
      );
    }
  });

  // When Vite is ready and mainWindow has loaded, pre-warm the floating widget
  mainWindow.webContents.on("did-finish-load", () => {
    createFloatingWidget();
    createChatWindow();
  });

  // When user minimizes main window → hide it, show floating widget instead
  mainWindow.on("minimize", () => {
    // Use setImmediate so the minimize animation finishes before we hide
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      showFloatingWidget();
    });
  });

  // Intercept the close button: hide to tray widget instead of quitting
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      showFloatingWidget();
    }
  });

  const loadApp = () => {
    mainWindow.loadURL("http://localhost:5173").catch(() => {
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
  // Keep the chat overlay inside the screen when monitors or scale change.
  screen.on("display-metrics-changed", () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      const size = computeChatSize();
      applyFixedSize(chatWindow, size.width, size.height);
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0] });
        } else {
          callback({});
        }
      })
      .catch((err) => {
        console.error("[Screen Capture] Error retrieving sources:", err);
        callback({});
      });
  });

  startBackendService();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      restoreMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Don't quit — windows are hidden, not closed.
  // The app quits only via before-quit (e.g., from Task Manager or explicit quit).
  if (process.platform !== "darwin") {
    // Only quit if ALL windows are actually destroyed (not just hidden)
    const allDestroyed = BrowserWindow.getAllWindows().every((w) =>
      w.isDestroyed(),
    );
    if (allDestroyed) app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (floatingWidget && !floatingWidget.isDestroyed()) {
    floatingWidget.destroy();
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.destroy();
  }
  stopBackendService();
});

process.on("exit", () => {
  stopBackendService();
});
