import { useState, useEffect } from 'react';
import './App.css';

declare global {
  interface Window {
    electronAPI?: {
      setSessionState: (state: string) => void;
      getCurrentSessionState: () => Promise<string>;
      onSyncSessionState: (callback: (state: string) => void) => () => void;
      triggerSessionAction: (action: string) => void;
      onSessionAction: (callback: (action: string) => void) => () => void;
      restoreMainWindow: () => void;
      minimizeToWidget: () => void;
      sendFrameContext: (frameBuffer: ArrayBuffer, requestId?: string) => Promise<{ success: boolean; status?: number; error?: string }>;
    };
  }
}

interface CaptureResult {
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationMs: number;
  timestamp: string;
  backendDispatched?: boolean;
}

type SessionState = 'idle' | 'monitoring' | 'paused';

// ─── Floating Widget (separate BrowserWindow) ─────────────────────────────────
function FloatingWidget() {
  const [state, setState] = useState<SessionState>('idle');

  useEffect(() => {
    // Fetch authoritative state from main process on mount
    window.electronAPI?.getCurrentSessionState().then((s) => {
      if (s) setState(s as SessionState);
    });

    // Subscribe to live state broadcasts from main process
    const unsubscribe = window.electronAPI?.onSyncSessionState((newState) => {
      setState(newState as SessionState);
    });

    return () => unsubscribe?.();
  }, []);

  const handleAction = (action: string) => {
    console.log('[FloatingWidget] Action triggered:', action);
    if (action === 'start' || action === 'resume') setState('monitoring');
    if (action === 'pause') setState('paused');
    if (action === 'stop') setState('idle');
    window.electronAPI?.triggerSessionAction(action);
  };

  const handleExpand = () => {
    console.log('[FloatingWidget] Restoring main window');
    window.electronAPI?.restoreMainWindow();
  };

  return (
    <div className="floating-bar">
      <div className="floating-drag">
        <span className={`status-indicator status-${state}`} />
        <span className="floating-label">
          {state === 'monitoring' ? 'Monitoring' : state === 'paused' ? 'Paused' : 'SLC · Idle'}
        </span>
      </div>

      <div className="floating-actions">
        {state === 'idle' && (
          <button
            type="button"
            className="btn btn-primary btn-mini"
            onClick={() => handleAction('start')}
          >
            ▶ Start
          </button>
        )}

        {state === 'monitoring' && (
          <button
            type="button"
            className="btn btn-secondary btn-mini"
            onClick={() => handleAction('pause')}
          >
            ⏸ Pause
          </button>
        )}

        {state === 'paused' && (
          <button
            type="button"
            className="btn btn-primary btn-mini"
            onClick={() => handleAction('resume')}
          >
            ▶ Resume
          </button>
        )}

        {state !== 'idle' && (
          <button
            type="button"
            className="btn btn-danger btn-mini"
            onClick={() => handleAction('stop')}
          >
            ■ Stop
          </button>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-mini"
          title="Expand dashboard"
          onClick={handleExpand}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [capturing, setCapturing] = useState(false);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync state to main process whenever it changes in the UI
  useEffect(() => {
    window.electronAPI?.setSessionState(sessionState);
  }, [sessionState]);

  // Handle actions forwarded from the floating widget
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSessionAction((action) => {
      if (action === 'start') setSessionState('monitoring');
      if (action === 'pause') setSessionState('paused');
      if (action === 'resume') setSessionState('monitoring');
      if (action === 'stop') {
        setSessionState('idle');
        setLastCapture((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
      }
    });
    return () => unsubscribe?.();
  }, []);

  const handleStopSession = () => {
    setSessionState('idle');
    setLastCapture((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  const handleCaptureFrame = async () => {
    setCapturing(true);
    setErrorMsg(null);
    const startTime = performance.now();

    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });

      video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        if (!video) return reject(new Error('Video initialization failed'));
        video.onloadedmetadata = () => {
          video?.play().then(resolve).catch(reject);
        };
        video.onerror = () => reject(new Error('Stream playback failed'));
      });

      await new Promise((r) => setTimeout(r, 80));

      const width = video.videoWidth;
      const height = video.videoHeight;

      if (!width || !height) {
        throw new Error('Invalid frame dimensions received');
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D context unavailable');

      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.85);
      });

      if (!blob) throw new Error('JPEG compression failed');

      const durationMs = Math.round(performance.now() - startTime);

      // Contract context.md: Dispatch JPEG bytes to backend orchestrator via IPC
      let backendDispatched = false;
      if (window.electronAPI?.sendFrameContext) {
        try {
          const buffer = await blob.arrayBuffer();
          const dispatchRes = await window.electronAPI.sendFrameContext(buffer, `test_${Date.now()}`);
          backendDispatched = dispatchRes?.success ?? false;
        } catch (dispatchErr) {
          console.warn('[Capture Pipeline] Backend dispatch failed:', dispatchErr);
        }
      }

      if (lastCapture?.previewUrl) {
        URL.revokeObjectURL(lastCapture.previewUrl);
      }

      setLastCapture({
        previewUrl: URL.createObjectURL(blob),
        width,
        height,
        sizeBytes: blob.size,
        durationMs,
        timestamp: new Date().toLocaleTimeString(),
        backendDispatched,
      });
    } catch (err: unknown) {
      console.error('[Capture Error]', err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
    } finally {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (video) {
        video.srcObject = null;
        video.remove();
      }
      setCapturing(false);
    }
  };

  return (
    <div className="layout">
      {/* Top Navigation Bar */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">Smart Learning Companion</span>
          <span className="brand-tag">v0.1.0-alpha · Lane F</span>
        </div>

        <div className="topbar-right">
          <div className="system-status">
            <span className={`status-indicator status-${sessionState}`} />
            <span className="status-label">
              {sessionState === 'idle' && 'Session Idle'}
              {sessionState === 'monitoring' && 'Monitoring Active'}
              {sessionState === 'paused' && 'Monitoring Paused'}
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            title="Minimize to floating widget"
            onClick={() => window.electronAPI?.minimizeToWidget()}
          >
            ⊟ Minimize
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="content">
        {/* Session Control Panel */}
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Session Management</h2>
              <p className="panel-description">
                Controls the active study session and screen monitoring stream.
              </p>
            </div>
            <div className="action-row">
              {sessionState === 'idle' ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setSessionState('monitoring')}
                >
                  ▶ Start Session
                </button>
              ) : (
                <>
                  {sessionState === 'monitoring' ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setSessionState('paused')}
                    >
                      ⏸ Pause
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={() => setSessionState('monitoring')}
                    >
                      ▶ Resume
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    onClick={handleStopSession}
                  >
                    ■ Stop
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Screen Capture & Diagnostic Panel */}
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Screen Capture Pipeline</h2>
              <p className="panel-description">
                Verifies in-memory frame grabbing before dispatch to .NET orchestrator.
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleCaptureFrame}
              disabled={capturing}
            >
              {capturing ? 'Capturing Frame...' : 'Capture Test Frame'}
            </button>
          </div>

          {errorMsg && (
            <div className="callout callout-error">
              <span>{errorMsg}</span>
            </div>
          )}

          {lastCapture && (
            <div className="capture-details">
              <table className="meta-table">
                <tbody>
                  <tr>
                    <th>Resolution</th>
                    <td>{lastCapture.width} × {lastCapture.height} px</td>
                    <th>Payload Size</th>
                    <td>{(lastCapture.sizeBytes / 1024).toFixed(1)} KB (image/jpeg)</td>
                  </tr>
                  <tr>
                    <th>Capture Latency</th>
                    <td>{lastCapture.durationMs} ms</td>
                    <th>Timestamp</th>
                    <td>{lastCapture.timestamp}</td>
                  </tr>
                  <tr>
                    <th>Memory Policy</th>
                    <td>In-memory buffer only · Zero disk write</td>
                    <th>Backend Pipeline</th>
                    <td>
                      {lastCapture.backendDispatched
                        ? '✅ 202 Accepted (POST /context/frame)'
                        : 'Local in-memory preview'}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="frame-preview">
                <div className="preview-bar">
                  <span>Frame Buffer Preview</span>
                </div>
                <img
                  src={lastCapture.previewUrl}
                  alt="Captured frame buffer"
                  className="preview-img"
                />
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>Local Endpoint: 127.0.0.1:5050</span>
        <span>Process Model: Electron → .NET → Python</span>
      </footer>
    </div>
  );
}

// ─── Root: route to FloatingWidget or Dashboard based on URL param ─────────────
function App() {
  const isFloating = new URLSearchParams(window.location.search).get('view') === 'floating';
  return isFloating ? <FloatingWidget /> : <Dashboard />;
}

export default App;
