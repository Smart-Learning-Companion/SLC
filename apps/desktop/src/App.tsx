import { useState, useEffect, useRef, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
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
      getBackendConfig?: () => Promise<{ port: string; token: string }>;
      sendAlertResponse?: (alertId: string, accepted: boolean) => Promise<{ success: boolean; status?: number; error?: string }>;
      triggerHelpNow?: () => Promise<{ success: boolean; status?: number; error?: string }>;
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

export interface SoftAlert {
  alertId: string;
  kind: 'confusion' | 'drowsiness';
  t: number;
}

export interface ActiveExplanation {
  requestId: string;
  text: string;
  language: string;
  timestamp: string;
}

type SessionState = 'idle' | 'monitoring' | 'paused';

// ─── 🎨 Handcrafted Professional SVG Icons ─────────────────────────────────────
function ShieldIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ScanTextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3H5a2 2 0 0 0-2 2v2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M3 17v2a2 2 0 0 0 2 2h2" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="13" x2="13" y2="13" />
    </svg>
  );
}

function VideoOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1" />
      <path d="m23 7-7 5 7 5V7z" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="4" width="4" height="16" rx="1" />
      <rect x="15" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}



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
            <PlayIcon /> Start
          </button>
        )}

        {state === 'monitoring' && (
          <button
            type="button"
            className="btn btn-secondary btn-mini"
            onClick={() => handleAction('pause')}
          >
            <PauseIcon /> Pause
          </button>
        )}

        {state === 'paused' && (
          <button
            type="button"
            className="btn btn-primary btn-mini"
            onClick={() => handleAction('resume')}
          >
            <PlayIcon /> Resume
          </button>
        )}

        {state === 'monitoring' && (
          <button
            type="button"
            className="btn btn-mini btn-help"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            title="Request Quick Help"
            onClick={() => {
              window.electronAPI?.triggerHelpNow?.();
              handleExpand();
            }}
          >
            <SparklesIcon /> Help
          </button>
        )}

        {state !== 'idle' && (
          <button
            type="button"
            className="btn btn-danger btn-mini"
            onClick={() => handleAction('stop')}
          >
            <StopIcon /> Stop
          </button>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-mini"
          title="Expand dashboard"
          onClick={handleExpand}
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );
}

// ─── 🛡️ Privacy Consent Modal Component ──────────────────────────────────────
interface ConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConsentModal({ isOpen, onClose, onConfirm }: ConsentModalProps) {
  const [agreed, setAgreed] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-row">
            <h3 id="consent-title" className="modal-title">
              <span className="icon-shield"><ShieldIcon /></span>
              Study Session & Screen Monitoring Consent
            </h3>
            <span className="brand-tag">Privacy-by-Design</span>
          </div>
          <p className="modal-subtitle">
            Smart Learning Companion · Local In-Memory Architecture (Contracts v1)
          </p>
        </div>

        <div className="modal-body">
          <div className="privacy-list">
            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <LockIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">Zero Disk Storage · Ephemeral RAM Only</span>
                <span className="privacy-item-desc">
                  Webcam features and screen frames are analyzed exclusively in temporary volatile memory and purged immediately after processing.
                </span>
              </div>
            </div>

            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <GlobeIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">Strict Localhost Isolation (No Cloud Video)</span>
                <span className="privacy-item-desc">
                  Raw screen captures and camera frames never leave your device. All local services communicate strictly over 127.0.0.1.
                </span>
              </div>
            </div>

            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <ScanTextIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">On-Demand OCR Text to LLM</span>
                <span className="privacy-item-desc">
                  Only when sustained confusion/drowsiness is confirmed (8s window) or upon manual quick-help request, local OCR extracts text from your screen. Only technical text is sent to Gemini for Sinhala explanations.
                </span>
              </div>
            </div>

            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <VideoOffIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">Instant Stream Teardown on Pause/Stop</span>
                <span className="privacy-item-desc">
                  You maintain full control. Pausing or stopping the session immediately executes track.stop(), extinguishing all OS screen capture indicators.
                </span>
              </div>
            </div>
          </div>

          <label className="consent-checkbox-row">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              id="consent-check"
            />
            <span className="consent-checkbox-label">
              I understand and consent to local screen capture under these privacy terms for this study session.
            </span>
          </label>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!agreed}
            onClick={onConfirm}
          >
            <CheckIcon /> Accept & Start Monitoring
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsented, setHasConsented] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // SignalR & Backend state
  const [signalRConnected, setSignalRConnected] = useState(false);
  const [backendPort, setBackendPort] = useState<string>('8100');
  const [activeAlert, setActiveAlert] = useState<SoftAlert | null>(null);
  const [activeExplanation, setActiveExplanation] = useState<ActiveExplanation | null>(null);
  const [explanationLang, setExplanationLang] = useState<'si' | 'en'>('si');
  const [requestingHelp, setRequestingHelp] = useState(false);

  // Persistent MediaStream and hidden playback Video element
  const activeStreamRef = useRef<MediaStream | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [isStreamActive, setIsStreamActive] = useState(false);

  // Sync state to main process whenever it changes in the UI
  useEffect(() => {
    window.electronAPI?.setSessionState(sessionState);
  }, [sessionState]);

  // Clean up stream tracks and memory
  const cleanupStream = useCallback(() => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore already stopped tracks
        }
      });
      activeStreamRef.current = null;
    }
    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
      videoElementRef.current.remove();
      videoElementRef.current = null;
    }
    setIsStreamActive(false);
  }, []);

  // Initialize and hold continuous screen stream
  const startScreenStream = useCallback(async (): Promise<boolean> => {
    setErrorMsg(null);
    try {
      cleanupStream();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No video track returned from screen capture source');
      }

      // Handle OS-level stream cancellation (e.g., user clicks "Stop sharing" on system bar)
      videoTrack.onended = () => {
        console.log('[Screen Capture] Track stopped by user/system.');
        cleanupStream();
        setSessionState('idle');
        setLastCapture((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
      };

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(reject);
        };
        video.onerror = () => reject(new Error('Failed to play stream track'));
      });

      activeStreamRef.current = stream;
      videoElementRef.current = video;
      setIsStreamActive(true);
      return true;
    } catch (err: unknown) {
      console.error('[Stream Error]', err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Screen capture was cancelled or failed: ${msg}`);
      cleanupStream();
      return false;
    }
  }, [cleanupStream]);

  // Session Control Handlers
  const handleStartSessionRequest = () => {
    if (!hasConsented) {
      setShowConsentModal(true);
    } else {
      executeStartSession();
    }
  };

  const executeStartSession = async () => {
    setShowConsentModal(false);
    const ok = await startScreenStream();
    if (ok) {
      setSessionState('monitoring');
    }
  };

  const handlePauseSession = useCallback(() => {
    cleanupStream();
    setSessionState('paused');
  }, [cleanupStream]);

  const handleResumeSession = async () => {
    const ok = await startScreenStream();
    if (ok) {
      setSessionState('monitoring');
    }
  };

  const handleStopSession = useCallback(() => {
    cleanupStream();
    setSessionState('idle');
    setActiveAlert(null);
    setActiveExplanation(null);
    setLastCapture((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, [cleanupStream]);

  // Capture Frame Handler (uses active in-memory stream for instant <50ms grab)
  const handleCaptureFrame = useCallback(async (overrideRequestId?: string) => {
    setCapturing(true);
    setErrorMsg(null);
    const startTime = performance.now();

    let tempStream: MediaStream | null = null;
    let video = videoElementRef.current;

    try {
      if (!video || !isStreamActive || video.readyState < 2) {
        tempStream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'monitor' },
          audio: false,
        });

        video = document.createElement('video');
        video.srcObject = tempStream;
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
      }

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
      const reqId = overrideRequestId || `req_${Date.now()}`;

      // Contract context.md: Dispatch raw JPEG bytes to backend orchestrator via IPC
      let backendDispatched = false;
      if (window.electronAPI?.sendFrameContext) {
        try {
          const buffer = await blob.arrayBuffer();
          const dispatchRes = await window.electronAPI.sendFrameContext(buffer, reqId);
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
      if (tempStream) {
        tempStream.getTracks().forEach((track) => track.stop());
      }
      setCapturing(false);
    }
  }, [isStreamActive, lastCapture]);

  // Keep a ref to handleCaptureFrame for SignalR callback without re-triggers
  const handleCaptureFrameRef = useRef(handleCaptureFrame);
  useEffect(() => {
    handleCaptureFrameRef.current = handleCaptureFrame;
  }, [handleCaptureFrame]);

  // ─── ⚡ SignalR Hub Connection Lifecycle ────────────────────────────────────
  useEffect(() => {
    let hubConnection: signalR.HubConnection | null = null;
    let isMounted = true;

    async function initSignalR() {
      try {
        const config = await window.electronAPI?.getBackendConfig?.();
        if (!config || !isMounted) return;

        setBackendPort(config.port);
        const hubUrl = `http://127.0.0.1:${config.port}/hub`;
        console.log(`[SignalR] Initializing hub connection to ${hubUrl}...`);

        const connection = new signalR.HubConnectionBuilder()
          .withUrl(hubUrl, {
            accessTokenFactory: () => config.token,
          })
          .withAutomaticReconnect([0, 2000, 5000, 10000])
          .configureLogging(signalR.LogLevel.Warning)
          .build();

        // 1. Status event: synchronize session state and metrics
        connection.on('status', (data: { state?: SessionState; cpuPercent?: number }) => {
          if (!isMounted) return;
          console.log('[SignalR Status Event]', data);
          if (data?.state && (data.state === 'idle' || data.state === 'monitoring' || data.state === 'paused')) {
            setSessionState(data.state);
          }
        });

        // 2. SoftAlert event: confusion or drowsiness detected by perception service
        connection.on('softAlert', (data: SoftAlert) => {
          if (!isMounted) return;
          console.log('[SignalR SoftAlert Event]', data);
          setActiveAlert(data);
        });

        // 3. CaptureRequest event: orchestrator requests a frame grab for OCR/Gemini
        connection.on('captureRequest', async (data: { requestId: string }) => {
          if (!isMounted) return;
          console.log('[SignalR CaptureRequest Event]', data);
          if (data?.requestId) {
            await handleCaptureFrameRef.current(data.requestId);
          }
        });

        // 4. Explanation event: AI tutor response received
        connection.on('explanation', (data: { requestId: string; text: string; language: string }) => {
          if (!isMounted) return;
          console.log('[SignalR Explanation Event]', data);
          setActiveExplanation({
            requestId: data.requestId,
            text: data.text,
            language: data.language || 'en',
            timestamp: new Date().toLocaleTimeString(),
          });
          setRequestingHelp(false);
        });

        connection.onreconnected(() => {
          if (isMounted) setSignalRConnected(true);
        });
        connection.onclose(() => {
          if (isMounted) setSignalRConnected(false);
        });

        await connection.start();
        if (isMounted) {
          setSignalRConnected(true);
          hubConnection = connection;
          console.log('[SignalR] Connected successfully to Orchestrator Hub.');
        }
      } catch (err) {
        console.warn('[SignalR Connection] Hub unavailable or initializing:', err);
        if (isMounted) setSignalRConnected(false);
      }
    }

    initSignalR();

    return () => {
      isMounted = false;
      hubConnection?.stop();
    };
  }, []);

  // Soft-Alert Response Handler (Contract: POST /alerts/{id}/response)
  const handleAlertResponse = async (accepted: boolean) => {
    if (!activeAlert) return;
    const alertId = activeAlert.alertId;
    setActiveAlert(null);

    if (window.electronAPI?.sendAlertResponse) {
      await window.electronAPI.sendAlertResponse(alertId, accepted);
    }

    if (accepted) {
      await handleTriggerQuickHelp();
    }
  };

  // Quick Help Handler (Contract: POST /help/now)
  const handleTriggerQuickHelp = async () => {
    setRequestingHelp(true);
    setErrorMsg(null);
    try {
      if (window.electronAPI?.triggerHelpNow) {
        const res = await window.electronAPI.triggerHelpNow();
        if (!res?.success) {
          await handleCaptureFrame();
        }
      } else {
        await handleCaptureFrame();
      }
    } catch {
      await handleCaptureFrame();
    } finally {
      setTimeout(() => setRequestingHelp(false), 3000);
    }
  };

  // Handle actions forwarded from the floating widget
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSessionAction(async (action) => {
      if (action === 'start') {
        if (!hasConsented) {
          window.electronAPI?.restoreMainWindow();
          setShowConsentModal(true);
        } else {
          const ok = await startScreenStream();
          if (ok) setSessionState('monitoring');
        }
      } else if (action === 'pause') {
        handlePauseSession();
      } else if (action === 'resume') {
        const ok = await startScreenStream();
        if (ok) setSessionState('monitoring');
      } else if (action === 'stop') {
        handleStopSession();
      }
    });
    return () => unsubscribe?.();
  }, [hasConsented, startScreenStream, handlePauseSession, handleStopSession]);

  // Teardown stream on unmount
  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  return (
    <div className="layout">
      {/* Privacy Consent Modal */}
      <ConsentModal
        isOpen={showConsentModal}
        onClose={() => setShowConsentModal(false)}
        onConfirm={() => {
          setHasConsented(true);
          executeStartSession();
        }}
      />

      {/* Top Navigation Bar */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-title">Smart Learning Companion</span>
          <span className="brand-tag">v0.1.0-alpha · Lane F</span>
        </div>

        <div className="topbar-right">
          <span
            className="brand-tag"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: signalRConnected ? '#3fb950' : '#8b949e',
            }}
            title={signalRConnected ? 'SignalR WebSockets Connected' : 'SignalR Hub Reconnecting'}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: signalRConnected ? '#3fb950' : '#8b949e',
                boxShadow: signalRConnected ? '0 0 6px rgba(63, 185, 80, 0.6)' : 'none',
              }}
            />
            {signalRConnected ? 'SignalR Live' : 'SignalR Standby'}
          </span>

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
            <MinimizeIcon /> Minimize
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="content">
        {/* ─── 🔔 Soft-Alert Banner (Contextual Confusion Nudge) ─── */}
        {activeAlert && (
          <div className="soft-alert-banner" role="alert">
            <div className="soft-alert-left">
              <div className="soft-alert-icon-box">
                <AlertTriangleIcon />
              </div>
              <div>
                <div className="soft-alert-title">
                  <span>Stuck on a concept? (අවබෝධ කරගැනීමට අපහසුද?)</span>
                  <span className="soft-alert-badge">{activeAlert.kind} detected</span>
                </div>
                <div className="soft-alert-desc">
                  We noticed subtle cues that you might need a hand. Would you like a brief explanation of what's currently on your screen?
                </div>
              </div>
            </div>
            <div className="soft-alert-actions">
              <button
                type="button"
                className="btn-alert-accept"
                onClick={() => handleAlertResponse(true)}
              >
                <SparklesIcon /> Yes, Help Me (උදව් ලබාගන්න)
              </button>
              <button
                type="button"
                className="btn-alert-dismiss"
                onClick={() => handleAlertResponse(false)}
              >
                I'm Fine (අවශ්‍ය නැත)
              </button>
            </div>
          </div>
        )}

        {/* ─── 💡 AI Tutor Contextual Explanation Card ─── */}
        {activeExplanation && (
          <div className="explanation-panel">
            <div className="explanation-header">
              <div className="explanation-title-row">
                <span className="explanation-icon"><SparklesIcon /></span>
                <h3 className="explanation-title">Contextual AI Tutor Assistance</h3>
              </div>
              <div className="explanation-controls">
                <div className="lang-toggle">
                  <button
                    type="button"
                    className={`lang-btn ${explanationLang === 'si' ? 'active' : ''}`}
                    onClick={() => setExplanationLang('si')}
                  >
                    සිංහල
                  </button>
                  <button
                    type="button"
                    className={`lang-btn ${explanationLang === 'en' ? 'active' : ''}`}
                    onClick={() => setExplanationLang('en')}
                  >
                    English
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-mini"
                  onClick={() => setActiveExplanation(null)}
                  title="Dismiss explanation"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="explanation-body">
              {activeExplanation.text}
            </div>
            <div className="explanation-footer">
              <span className="explanation-req-badge">Req ID: {activeExplanation.requestId}</span>
              <span>Delivered at {activeExplanation.timestamp} · Privacy Verified</span>
            </div>
          </div>
        )}

        {/* Session Control Panel */}
        <section className="panel">
          <div className="panel-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 className="panel-title">Session Management</h2>
                <span className="stream-status-badge">
                  <span className={`stream-dot ${isStreamActive ? 'active' : 'inactive'}`} />
                  {isStreamActive ? 'Stream: Active (In-Memory)' : 'Stream: Closed'}
                </span>
              </div>
              <p className="panel-description">
                Controls the active study session, continuous screen stream lifecycle, and live SignalR tutoring pipeline.
              </p>
            </div>
            <div className="action-row">
              {sessionState === 'idle' ? (
                <button
                  className="btn btn-primary"
                  onClick={handleStartSessionRequest}
                >
                  <PlayIcon /> Start Session
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-help"
                    onClick={handleTriggerQuickHelp}
                    disabled={requestingHelp}
                    title="Request immediate contextual explanation"
                  >
                    <SparklesIcon /> {requestingHelp ? 'Analyzing...' : 'Help Now'}
                  </button>

                  {sessionState === 'monitoring' ? (
                    <button
                      className="btn btn-secondary"
                      onClick={handlePauseSession}
                    >
                      <PauseIcon /> Pause
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={handleResumeSession}
                    >
                      <PlayIcon /> Resume
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    onClick={handleStopSession}
                  >
                    <StopIcon /> Stop
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
                {isStreamActive
                  ? 'Grabbing instant frames directly from in-memory stream (<50ms, zero OS prompt).'
                  : 'Diagnostic one-off capture or activates automatically upon session start.'}
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => handleCaptureFrame()}
              disabled={capturing}
            >
              <CameraIcon />
              {capturing ? 'Capturing Frame...' : isStreamActive ? 'Grab Current Frame' : 'Capture Test Frame'}
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
        <span>Local Orchestrator: 127.0.0.1:{backendPort}</span>
        <span>Process Model: Electron → .NET 10 → Python</span>
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
