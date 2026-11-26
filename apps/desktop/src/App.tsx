import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as signalR from "@microsoft/signalr";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import "./App.css";

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
      sendFrameContext: (
        frameBuffer: ArrayBuffer,
        requestId?: string,
        wait?: boolean,
      ) => Promise<{
        success: boolean;
        status?: number;
        data?: { requestId: string; text: string; language: string };
        error?: string;
      }>;
      getBackendConfig?: () => Promise<{ port: string; token: string }>;
      sendAlertResponse?: (
        alertId: string,
        accepted: boolean,
      ) => Promise<{ success: boolean; status?: number; error?: string }>;
      triggerHelpNow?: () => Promise<{
        success: boolean;
        status?: number;
        error?: string;
      }>;
      logExplanation?: (data: {
        requestId: string;
        text: string;
        language: string;
      }) => void;
      openChatWindow?: () => void;
      closeChatWindow?: () => void;
      onNewExplanation?: (
        callback: (data: {
          requestId: string;
          text: string;
          language?: string;
        }) => void,
      ) => () => void;
      sendChatMessage?: (data: {
        history: { role: string; text: string }[];
        message: string;
        contextText?: string;
      }) => Promise<{ success: boolean; reply?: string; error?: string }>;
      requestScreenCapture?: () => void;
      fitWidget?: (width: number, height: number) => void;
      onRequestScreenCapture?: (callback: () => void) => () => void;
      onCaptureState?: (
        callback: (event: {
          phase: "started" | "failed";
          error?: string;
        }) => void,
      ) => () => void;
      captureBegin?: (requestId: string) => Promise<boolean>;
      captureEnd?: () => void;
      reportCaptureFailure?: (message: string) => void;
      openExternalLink?: (url: string) => void;
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
  kind: "confusion" | "drowsiness";
  t: number;
}

export interface ActiveExplanation {
  requestId: string;
  text: string;
  language: string;
  timestamp: string;
}

type SessionState = "idle" | "monitoring" | "paused";

// ─── Handcrafted Professional SVG Icons ─────────────────────────────────────────
function ShieldIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ScanTextIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1" />
      <path d="m23 7-7 5 7 5V7z" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5" y="4" width="4" height="16" rx="1" />
      <rect x="15" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="2" r="1.2" />
      <circle cx="7" cy="2" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="7" cy="7" r="1.2" />
      <circle cx="3" cy="12" r="1.2" />
      <circle cx="7" cy="12" r="1.2" />
    </svg>
  );
}

function MessageSquareIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function HelpCircleIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ─── Floating Side Overlay AI Tutor Chat (separate BrowserWindow) ─────────────
interface ChatMessage {
  id: string;
  role: "user" | "tutor";
  text: string;
  timestamp: string;
}

const nowLabel = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function createInitialMessages(): ChatMessage[] {
  return [
    {
      id: "init",
      role: "tutor",
      text: "ආයුබෝවන්! මම ඔබගේ AI Companion Tutor. Screen එකේ ඇති පාඩම හෝ කේතය පිළිබඳ ඕනෑම ගැටලුවක් මෙතනින් විමසන්න.",
      timestamp: nowLabel(),
    },
  ];
}

// UI-only messages (greeting, spinner text, capture errors) are not part of
// the conversation and are never sent to Gemini as history.
function isTransientMessage(m: ChatMessage): boolean {
  return (
    m.id === "init" ||
    m.id.startsWith("loading_") ||
    m.id.startsWith("capfail_")
  );
}

// ─── Markdown Parser & Renderer Setup ──────────────────────────────────────────
function fallbackCopy(text: string): boolean {
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("[Markdown] Fallback copy failed:", err);
    return false;
  }
}

function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

// encodeURIComponent throws a URIError on an unpaired UTF-16 surrogate, which
// model output or pasted text can contain. Replace those with U+FFFD first.
function toWellFormed(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Open a link from a tutor reply. Only http(s) goes out; the main process
// validates it again and hands it to the system browser.
function openExternalUrl(href: string): void {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

  if (window.electronAPI?.openExternalLink) {
    window.electronAPI.openExternalLink(parsed.toString());
  } else {
    // Plain-browser dev (no Electron bridge)
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  }
}

const markedParser = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const code = text || "";
      const language = (lang || "code").toLowerCase();
      const displayLang = (lang || "code").toUpperCase();
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const encoded = encodeURIComponent(toWellFormed(code));
      return `<div class="code-box">
        <div class="code-box-header">
          <span class="code-box-lang">${displayLang}</span>
          <button type="button" class="code-copy-btn" data-code="${encoded}" title="Copy code">
            <svg class="code-copy-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            <span class="copy-label">Copy</span>
          </button>
        </div>
        <pre class="code-box-pre"><code class="language-${language}">${escaped}</code></pre>
      </div>`;
    },
    link({ href, title, text }: { href: string; title?: string | null; text: string }): string {
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr} class="chat-markdown-link">${text}</a>`;
    },
  },
});

function sanitizeSinhalaUnicode(text: string): string {
  // Normalize to Unicode Canonical Composition (NFC)
  let normalized = text.normalize("NFC");
  // Clean standalone Sinhala combining marks that appear without a base consonant
  // (e.g. immediately after whitespace, punctuation, or at start of string)
  normalized = normalized.replace(
    /(^|[\s\p{P}])[\u0D81\u0D82\u0D83\u0DCA-\u0DDF\u0DF2\u0DF3]+/gu,
    "$1"
  );
  return normalized;
}

interface MarkdownMessageProps {
  content: string;
  isUser?: boolean;
}

function MarkdownMessage({ content, isUser }: MarkdownMessageProps) {
  const { header, body } = useMemo(() => {
    if (isUser) {
      return { header: null, body: content };
    }
    const match = content.match(/^\[Screen Analysis(?:\s*-\s*([^\]]+))?\]\s*\n*/i);
    if (match) {
      return {
        header: {
          title: "Screen Analysis",
          language: match[1]?.trim() || null,
        },
        body: content.slice(match[0].length),
      };
    }
    return { header: null, body: content };
  }, [content, isUser]);

  const sanitizedHtml = useMemo(() => {
    try {
      const cleanBody = sanitizeSinhalaUnicode(body);
      const parsed = markedParser.parse(cleanBody);
      const rawHtml = typeof parsed === "string" ? parsed : "";
      return DOMPurify.sanitize(rawHtml, {
        ADD_ATTR: [
          "target",
          "rel",
          "data-code",
          "viewBox",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
          "fill",
          "class",
          "title",
        ],
        ADD_TAGS: ["svg", "path", "rect", "span", "button", "div", "pre", "code"],
        ALLOW_DATA_ATTR: true,
      });
    } catch (err) {
      console.error("[MarkdownMessage] Parse error:", err);
      // Never hand unsanitized text to dangerouslySetInnerHTML: show it as text.
      return escapeHtml(body).replace(/\n/g, "<br />");
    }
  }, [body]);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Handle code copy button
    const copyBtn = target.closest<HTMLButtonElement>(".code-copy-btn");
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const encoded = copyBtn.getAttribute("data-code");
      if (encoded) {
        let code: string;
        try {
          code = decodeURIComponent(encoded);
        } catch {
          return; // malformed percent-encoding: nothing safe to copy
        }
        copyToClipboard(code).then((success) => {
          if (success) {
            const label = copyBtn.querySelector(".copy-label");
            if (label) {
              const original = label.textContent || "Copy";
              label.textContent = "Copied!";
              copyBtn.classList.add("copied");
              setTimeout(() => {
                label.textContent = original;
                copyBtn.classList.remove("copied");
              }, 2000);
            }
          }
        });
      }
      return;
    }

    // Links: open http(s) targets in the system browser through the main
    // process (popups are denied in the Electron windows, so window.open
    // would silently do nothing). In-page anchors never leave the overlay.
    const link = target.closest<HTMLAnchorElement>("a");
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      if (!(link.getAttribute("href") || "").startsWith("#")) {
        openExternalUrl(link.href);
      }
    }
  };

  return (
    <div className="chat-message-wrapper">
      {header && (
        <div className="screen-analysis-badge">
          <span className="badge-pulse" />
          <svg
            className="badge-icon"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="badge-title">{header.title}</span>
          {header.language && (
            <>
              <span className="badge-sep">•</span>
              <span className="badge-lang">{header.language}</span>
            </>
          )}
        </div>
      )}
      <div
        className="chat-markdown-content"
        onClick={handleContainerClick}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    </div>
  );
}

function FloatingWidget() {
  const [state, setState] = useState<SessionState>("idle");
  const isChatWindow =
    new URLSearchParams(window.location.search).get("mode") === "chat";
  const [messages, setMessages] =
    useState<ChatMessage[]>(createInitialMessages);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [screenContext, setScreenContext] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Refs mirror state that long-lived IPC callbacks need to read.
  const stateRef = useRef<SessionState>("idle");
  const isAnalyzingRef = useRef(false);
  // Bumped whenever the tutor context is replaced or cleared (new capture, new
  // explanation, session stop). A chat reply requested under an older
  // generation was built from stale context and is discarded.
  const contextGenRef = useRef(0);

  // Floating views need a transparent page with no scrollbars.
  useEffect(() => {
    document.documentElement.classList.add("view-floating");
    return () => document.documentElement.classList.remove("view-floating");
  }, []);

  // Compact bar: report its natural size so the window always fits the content
  // (state/label changes alter the width). The bar uses width: max-content, so
  // this never depends on the window size and cannot feed back into itself.
  useEffect(() => {
    const el = barRef.current;
    if (isChatWindow || !el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      window.electronAPI?.fitWidget?.(
        Math.ceil(rect.width),
        Math.ceil(rect.height),
      );
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [isChatWindow]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isChatWindow) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isChatWindow, isTyping, isAnalyzing]);

  const toggleExpand = useCallback(
    (expand?: boolean) => {
      const next = expand !== undefined ? expand : !isChatWindow;
      if (next) {
        window.electronAPI?.openChatWindow?.();
      } else {
        window.electronAPI?.closeChatWindow?.();
      }
    },
    [isChatWindow],
  );

  // Wipe everything that belongs to one study session (messages, screen
  // context, pending flags) and invalidate in-flight chat requests.
  const resetTutorSession = useCallback(() => {
    contextGenRef.current += 1;
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setIsTyping(false);
    setInputText("");
    setScreenContext("");
    setMessages(createInitialMessages());
  }, []);

  // Single entry point for session-state changes (local clicks and syncs from
  // the main process). Entering "idle" ends the session, so its tutor state is
  // cleared; otherwise the next session would send the previous session's
  // screen summary and conversation to Gemini.
  const applySessionState = useCallback(
    (next: SessionState) => {
      const prev = stateRef.current;
      stateRef.current = next;
      setState(next);
      if (next === "idle" && prev !== "idle") resetTutorSession();
    },
    [resetTutorSession],
  );

  // A capture started from ANY overlay: both renderers drop the previous
  // screen context together and show the loading state.
  const beginAnalyzing = useCallback(() => {
    contextGenRef.current += 1;
    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setIsTyping(false);
    setScreenContext("");
    setMessages([
      {
        id: `loading_${Date.now()}`,
        role: "tutor",
        text: "Screen එක Capture කරමින් AI Tutor වෙතින් විස්තරය ලබාගනිමින් පවතී... කරුණාකර රැඳෙන්න...",
        timestamp: nowLabel(),
      },
    ]);
  }, []);

  // Terminal failure of a capture (cancelled, no frame, backend rejected it):
  // the input and capture button must not stay disabled.
  const failAnalyzing = useCallback((error?: string) => {
    if (!isAnalyzingRef.current) return; // nothing was waiting on a capture
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setMessages([
      {
        id: `capfail_${Date.now()}`,
        role: "tutor",
        text: `Screen එක Capture කිරීමට නොහැකි වුණා${error ? `: ${error}` : ""}. කරුණාකර නැවත උත්සාහ කරන්න.`,
        timestamp: nowLabel(),
      },
    ]);
  }, []);

  useEffect(() => {
    window.electronAPI?.getCurrentSessionState?.().then((s) => {
      if (s) applySessionState(s as SessionState);
    });

    const unsubSync = window.electronAPI?.onSyncSessionState?.((newState) => {
      applySessionState(newState as SessionState);
    });

    const unsubCapture = window.electronAPI?.onCaptureState?.((evt) => {
      if (evt?.phase === "started") beginAnalyzing();
      else if (evt?.phase === "failed") failAnalyzing(evt.error);
    });

    // When an explanation arrives from OCR + Gemini
    const unsubExp = window.electronAPI?.onNewExplanation?.((data) => {
      console.log("[FloatingWidget] Received new explanation:", data);
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      if (data?.text) {
        // The screen context is replaced: chat replies still in flight were
        // generated from the old one and must not land in the new conversation.
        contextGenRef.current += 1;
        setIsTyping(false);
        setScreenContext(data.text);
        // Fresh context: replaces previous screen explanation with this new capture
        setMessages([
          {
            id: `exp_${Date.now()}`,
            role: "tutor",
            text: `[Screen Analysis - ${data.language === "en" ? "English" : "සිංහල"}]\n\n${data.text}`,
            timestamp: nowLabel(),
          },
        ]);
        toggleExpand(true);
      }
    });

    return () => {
      unsubSync?.();
      unsubCapture?.();
      unsubExp?.();
    };
  }, [toggleExpand, applySessionState, beginAnalyzing, failAnalyzing]);

  // Quick Help: ask the main process to capture. It broadcasts "capture
  // started" to BOTH overlay renderers (the mini bar and the chat drawer are
  // separate windows) and the dashboard grabs the frame, so the drawer cannot
  // keep stale messages while the new capture runs.
  const handleQuickHelp = () => {
    if (stateRef.current === "idle" || isAnalyzingRef.current) return;

    toggleExpand(true);
    window.electronAPI?.requestScreenCapture?.();
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isTyping || isAnalyzing) return;
    // Generation the answer will be valid for (see contextGenRef).
    const gen = contextGenRef.current;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    try {
      const history = messages
        .filter((m) => !isTransientMessage(m))
        .map((m) => ({
          role: m.role === "user" ? "user" : "model",
          text: m.text,
        }));

      const res = await window.electronAPI?.sendChatMessage?.({
        history,
        message: text,
        contextText: screenContext,
      });

      // The screen context was replaced (new capture / new explanation) or the
      // session was stopped while this request was in flight: its answer was
      // generated from the old context and history, so drop it.
      if (gen !== contextGenRef.current) return;

      if (res?.success && res.reply) {
        const replyText = res.reply;
        setMessages((prev) => [
          ...prev,
          {
            id: `tut_${Date.now()}`,
            role: "tutor",
            text: replyText,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: "tutor",
            text: `සමාවෙන්න, උත්තරය ලබාගැනීමේදී ගැටලුවක් මතු වුණා: ${res?.error || "Unknown error"}. කරුණාකර නැවත උත්සාහ කරන්න.`,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
      }
    } catch (err: unknown) {
      if (gen !== contextGenRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "tutor",
          text: `Error: ${msg}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } finally {
      // Only the request that still owns the context may clear the spinner.
      if (gen === contextGenRef.current) setIsTyping(false);
    }
  };

  const handleAction = (action: string) => {
    if (action === "start" || action === "resume")
      applySessionState("monitoring");
    if (action === "pause") applySessionState("paused");
    if (action === "stop") applySessionState("idle");
    window.electronAPI?.triggerSessionAction?.(action);
  };

  const handleExpandDashboard = () => {
    window.electronAPI?.restoreMainWindow?.();
  };

  // Compact Mode (Mini Floating Bar)
  if (!isChatWindow) {
    return (
      <div className="floating-bar" ref={barRef}>
        <div
          className="floating-drag"
          onClick={() => state !== "idle" && toggleExpand(true)}
        >
          <span className="drag-handle-grip" title="Drag to reposition">
            <GripIcon />
          </span>
          <span className={`status-indicator status-${state}`} />
          <span className="floating-label">
            {state === "monitoring"
              ? "Monitoring"
              : state === "paused"
                ? "Paused"
                : "SLC Idle"}
          </span>
        </div>

        <div className="floating-actions">
          {state === "idle" && (
            <button
              type="button"
              className="btn btn-primary btn-mini"
              aria-label="Start session"
              onClick={() => handleAction("start")}
            >
              <PlayIcon /> <span className="btn-text">Start</span>
            </button>
          )}

          {state === "monitoring" && (
            <button
              type="button"
              className="btn btn-secondary btn-mini"
              aria-label="Pause session"
              onClick={() => handleAction("pause")}
            >
              <PauseIcon /> <span className="btn-text">Pause</span>
            </button>
          )}

          {state === "paused" && (
            <button
              type="button"
              className="btn btn-primary btn-mini"
              aria-label="Resume session"
              onClick={() => handleAction("resume")}
            >
              <PlayIcon /> <span className="btn-text">Resume</span>
            </button>
          )}

          {/* Quick Help Button */}
          <button
            type="button"
            className="btn btn-mini btn-quick-help"
            title={
              state === "idle"
                ? "Start a study session first to enable Quick Help"
                : "Capture screen and generate explanation"
            }
            disabled={state === "idle" || isAnalyzing}
            onClick={handleQuickHelp}
          >
            <HelpCircleIcon /> <span className="btn-text">Help</span>
          </button>

          {/* Chat Drawer Button */}
          <button
            type="button"
            className="btn btn-mini btn-chat-toggle"
            title={
              state === "idle"
                ? "Start a study session first to enable Chat"
                : "Open AI Tutor Assistant"
            }
            disabled={state === "idle"}
            onClick={() => toggleExpand(true)}
          >
            <MessageSquareIcon /> <span className="btn-text">Chat</span>
          </button>

          {state !== "idle" && (
            <button
              type="button"
              className="btn btn-danger btn-mini"
              aria-label="Stop session"
              onClick={() => handleAction("stop")}
            >
              <StopIcon /> <span className="btn-text">Stop</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-mini"
            title="Expand dashboard"
            onClick={handleExpandDashboard}
          >
            <ExpandIcon />
          </button>
        </div>
      </div>
    );
  }

  // Expanded Mode (Side Overlay AI Tutor Chat)
  return (
    <div className="overlay-chat-container">
      {/* Draggable Header */}
      <div className="overlay-chat-header">
        <div className="overlay-chat-title">
          <span className="drag-handle-grip" title="Drag to reposition">
            <GripIcon />
          </span>
          <SparklesIcon />
          <span>AI Tutor Assistant</span>
          <span
            className={`status-indicator status-${state}`}
            style={{ width: 6, height: 6 }}
          />
        </div>
        <div className="overlay-chat-header-actions">
          <button
            type="button"
            className="chat-header-btn"
            title="Capture New Screen & Refresh Context"
            disabled={isAnalyzing || state === "idle"}
            onClick={handleQuickHelp}
          >
            <CameraIcon />
          </button>
          <button
            type="button"
            className="chat-header-btn"
            title="Expand Full Dashboard"
            onClick={handleExpandDashboard}
          >
            <ExpandIcon />
          </button>
          <button
            type="button"
            className="chat-header-btn"
            title="Collapse to Mini Bar"
            onClick={() => toggleExpand(false)}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="overlay-chat-messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-bubble-row ${msg.role === "user" ? "user-row" : "tutor-row"}`}
          >
            <div
              className={`chat-bubble ${msg.role === "user" ? "user-bubble" : "tutor-bubble"}`}
            >
              <MarkdownMessage content={msg.text} isUser={msg.role === "user"} />
              <div className="chat-bubble-time">{msg.timestamp}</div>
            </div>
          </div>
        ))}
        {(isTyping || isAnalyzing) && (
          <div className="chat-bubble-row tutor-row">
            <div className="chat-bubble tutor-bubble typing-bubble">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="typing-label">
                {isAnalyzing
                  ? "Analyzing current screen..."
                  : "Tutor is thinking..."}
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Suggestions Chips */}
      <div className="overlay-quick-chips">
        <button
          type="button"
          onClick={() =>
            handleSendMessage("මේක තව සරලව උදාහරණයකින් පැහැදිලි කරන්න.")
          }
        >
          සරල උදාහරණයක්
        </button>
        <button
          type="button"
          onClick={() => handleSendMessage("මේ code එකේ ප්‍රධාන steps මොනවාද?")}
        >
          ප්‍රධාන Steps
        </button>
        <button
          type="button"
          onClick={() => handleSendMessage("Explain this in English please.")}
        >
          In English
        </button>
      </div>

      {/* Input Box */}
      <form
        className="overlay-chat-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
      >
        <input
          type="text"
          className="overlay-chat-input"
          placeholder="Ask AI Tutor in Sinhala or English..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isTyping || isAnalyzing}
        />
        <button
          type="submit"
          className="overlay-chat-send-btn"
          disabled={!inputText.trim() || isTyping || isAnalyzing}
          title="Send"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

// ─── Privacy Consent Modal Component ──────────────────────────────────────────
interface ConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConsentModal({ isOpen, onClose, onConfirm }: ConsentModalProps) {
  const [agreed, setAgreed] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-row">
            <h3 id="consent-title" className="modal-title">
              <span className="icon-shield">
                <ShieldIcon />
              </span>
              Study Session & Screen Monitoring Consent
            </h3>
            <span className="brand-tag">Privacy-by-Design</span>
          </div>
          <p className="modal-subtitle">
            Smart Learning Companion · Local In-Memory Architecture (Contracts
            v1)
          </p>
        </div>

        <div className="modal-body">
          <div className="privacy-list">
            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <LockIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">
                  Zero Disk Storage · Ephemeral RAM Only
                </span>
                <span className="privacy-item-desc">
                  Webcam features and screen frames are analyzed exclusively in
                  temporary volatile memory and purged immediately after
                  processing.
                </span>
              </div>
            </div>

            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <GlobeIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">
                  Strict Localhost Isolation (No Cloud Video)
                </span>
                <span className="privacy-item-desc">
                  Raw screen captures and camera frames never leave your device.
                  All local services communicate strictly over 127.0.0.1.
                </span>
              </div>
            </div>

            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <ScanTextIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">
                  On-Demand OCR Text to LLM
                </span>
                <span className="privacy-item-desc">
                  Only when sustained confusion/drowsiness is confirmed (8s
                  window) or upon manual quick-help request, local OCR extracts
                  text from your screen. Only technical text is sent to Gemini
                  for Sinhala explanations.
                </span>
              </div>
            </div>

            <div className="privacy-item">
              <div className="privacy-item-icon-box">
                <VideoOffIcon />
              </div>
              <div className="privacy-item-content">
                <span className="privacy-item-title">
                  Instant Stream Teardown on Pause/Stop
                </span>
                <span className="privacy-item-desc">
                  You maintain full control. Pausing or stopping the session
                  immediately executes track.stop(), extinguishing all OS screen
                  capture indicators.
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
              I understand and consent to local screen capture under these
              privacy terms for this study session.
            </span>
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
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
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [hasConsented, setHasConsented] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [lastCapture, setLastCapture] = useState<CaptureResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // SignalR & Backend state
  const [signalRConnected, setSignalRConnected] = useState(false);
  const [backendPort, setBackendPort] = useState<string>("8100");
  const [activeAlert, setActiveAlert] = useState<SoftAlert | null>(null);
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
        video: { displaySurface: "monitor" },
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track returned from screen capture source");
      }

      // Handle OS-level stream cancellation (e.g., user clicks "Stop sharing" on system bar)
      videoTrack.onended = () => {
        console.log("[Screen Capture] Track stopped by user/system.");
        cleanupStream();
        setSessionState("idle");
        setLastCapture((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
      };

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(reject);
        };
        video.onerror = () => reject(new Error("Failed to play stream track"));
      });

      activeStreamRef.current = stream;
      videoElementRef.current = video;
      setIsStreamActive(true);
      return true;
    } catch (err: unknown) {
      console.error("[Stream Error]", err);
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
      setSessionState("monitoring");
    }
  };

  const handlePauseSession = useCallback(() => {
    cleanupStream();
    setSessionState("paused");
  }, [cleanupStream]);

  const handleResumeSession = async () => {
    const ok = await startScreenStream();
    if (ok) {
      setSessionState("monitoring");
    }
  };

  const handleStopSession = useCallback(() => {
    cleanupStream();
    setSessionState("idle");
    setActiveAlert(null);
    setLastCapture((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, [cleanupStream]);

  // Capture Frame Handler (uses active in-memory stream for instant <50ms grab)
  const handleCaptureFrame = useCallback(
    async (overrideRequestId?: string) => {
      setCapturing(true);
      setErrorMsg(null);
      const startTime = performance.now();
      const reqId = overrideRequestId || `req_${Date.now()}`;

      let tempStream: MediaStream | null = null;
      let video = videoElementRef.current;

      // A one-off share (diagnostic capture, paused-session help) is only
      // needed until the JPEG exists. It is stopped right then, not after the
      // OCR + Gemini round trip, because cleanupStream() (Pause/Stop) only
      // knows about activeStreamRef and could not end it.
      const releaseTempStream = () => {
        if (tempStream) {
          tempStream.getTracks().forEach((track) => track.stop());
          tempStream = null;
        }
      };

      try {
        if (!video || !isStreamActive || video.readyState < 2) {
          tempStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "monitor" },
            audio: false,
          });

          video = document.createElement("video");
          video.srcObject = tempStream;
          video.muted = true;
          video.playsInline = true;

          await new Promise<void>((resolve, reject) => {
            if (!video) return reject(new Error("Video initialization failed"));
            video.onloadedmetadata = () => {
              video?.play().then(resolve).catch(reject);
            };
            video.onerror = () => reject(new Error("Stream playback failed"));
          });

          await new Promise((r) => setTimeout(r, 80));
        }

        const width = video.videoWidth;
        const height = video.videoHeight;

        if (!width || !height) {
          throw new Error("Invalid frame dimensions received");
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D context unavailable");

        // The tutor overlays sit on top of the study material. Ask the main
        // process to hide them (it resolves once they are off screen), grab
        // the frame, then let it restore them. captureEnd runs on every path.
        let blob: Blob | null = null;
        try {
          await window.electronAPI?.captureBegin?.(reqId);
          ctx.drawImage(video, 0, 0, width, height);
          blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, "image/jpeg", 0.85);
          });
        } finally {
          window.electronAPI?.captureEnd?.();
        }

        // The frame is in memory: end the one-off screen share before the
        // (slow) backend round trip below.
        releaseTempStream();

        if (!blob) throw new Error("JPEG compression failed");

        const durationMs = Math.round(performance.now() - startTime);

        // Contract context.md: Dispatch raw JPEG bytes to backend orchestrator via IPC
        let backendDispatched = false;
        let dispatchError: string | null = null;
        if (window.electronAPI?.sendFrameContext) {
          try {
            const buffer = await blob.arrayBuffer();
            const dispatchRes = await window.electronAPI.sendFrameContext(
              buffer,
              reqId,
              true,
            );
            backendDispatched = dispatchRes?.success ?? false;
            if (!backendDispatched) {
              dispatchError =
                dispatchRes?.error ||
                `Backend returned HTTP ${dispatchRes?.status ?? "error"}`;
            }

            // If explanation is returned directly via HTTP response. SignalR
            // delivers the same requestId too; the main process forwards the
            // first one and drops the duplicate (or a stale one after Stop).
            if (dispatchRes?.data?.text) {
              const expData = dispatchRes.data;
              console.log("[Direct HTTP Explanation Result]", expData);
              window.electronAPI?.logExplanation?.(expData);
              setRequestingHelp(false);
            }
          } catch (dispatchErr) {
            console.warn(
              "[Capture Pipeline] Backend dispatch failed:",
              dispatchErr,
            );
            dispatchError =
              dispatchErr instanceof Error
                ? dispatchErr.message
                : String(dispatchErr);
          }
        }

        // Terminal failure: let the overlays leave their "analyzing" state.
        if (dispatchError) {
          window.electronAPI?.reportCaptureFailure?.(dispatchError);
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
        console.error("[Capture Error]", err);
        const message = err instanceof Error ? err.message : String(err);
        setErrorMsg(message);
        window.electronAPI?.reportCaptureFailure?.(message);
      } finally {
        releaseTempStream();
        setCapturing(false);
      }
    },
    [isStreamActive, lastCapture],
  );

  // Keep a ref to handleCaptureFrame for SignalR callback without re-triggers
  const handleCaptureFrameRef = useRef(handleCaptureFrame);
  useEffect(() => {
    handleCaptureFrameRef.current = handleCaptureFrame;
  }, [handleCaptureFrame]);

  // Listen for capture requests from the floating side-overlay chat
  useEffect(() => {
    const unsub = window.electronAPI?.onRequestScreenCapture?.(() => {
      console.log("[Dashboard] Screen capture requested from floating overlay");
      handleCaptureFrame();
    });
    return () => unsub?.();
  }, [handleCaptureFrame]);

  // ─── SignalR Hub Connection Lifecycle ──────────────────────────────────────
  useEffect(() => {
    let hubConnection: signalR.HubConnection | null = null;
    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

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
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
            withCredentials: false,
          })
          .withAutomaticReconnect([0, 2000, 5000, 10000])
          .configureLogging(signalR.LogLevel.Warning)
          .build();

        // 1. Status event: synchronize session state and metrics
        connection.on(
          "status",
          (data: { state?: SessionState; cpuPercent?: number }) => {
            if (!isMounted) return;
            console.log("[SignalR Status Event]", data);
            if (
              data?.state &&
              (data.state === "idle" ||
                data.state === "monitoring" ||
                data.state === "paused")
            ) {
              setSessionState(data.state);
            }
          },
        );

        // 2. SoftAlert event: confusion or drowsiness detected by perception service
        connection.on("softAlert", (data: SoftAlert) => {
          if (!isMounted) return;
          console.log("[SignalR SoftAlert Event]", data);
          setActiveAlert(data);
        });

        // 3. CaptureRequest event: orchestrator requests a frame grab for OCR/Gemini
        connection.on("captureRequest", async (data: { requestId: string }) => {
          if (!isMounted) return;
          console.log("[SignalR CaptureRequest Event]", data);
          if (data?.requestId) {
            await handleCaptureFrameRef.current(data.requestId);
          }
        });

        // 4. Explanation event: AI tutor response received
        connection.on(
          "explanation",
          (data: { requestId: string; text: string; language: string }) => {
            if (!isMounted) return;
            console.log("[SignalR Explanation Event]", data);
            window.electronAPI?.logExplanation?.(data);
            setRequestingHelp(false);
          },
        );

        connection.onreconnected(() => {
          if (isMounted) setSignalRConnected(true);
        });
        connection.onclose(() => {
          if (isMounted) {
            setSignalRConnected(false);
            retryTimer = setTimeout(() => tryConnect(connection), 2000);
          }
        });

        async function tryConnect(conn: signalR.HubConnection) {
          if (!isMounted) return;
          try {
            await conn.start();
            if (isMounted) {
              setSignalRConnected(true);
              hubConnection = conn;
              console.log(
                "[SignalR] Connected successfully to Orchestrator Hub.",
              );
            }
          } catch (connErr) {
            if (!isMounted) return;
            console.warn(
              "[SignalR Connection] Hub not ready yet, retrying in 2s...",
              connErr,
            );
            setSignalRConnected(false);
            retryTimer = setTimeout(() => tryConnect(conn), 2000);
          }
        }

        await tryConnect(connection);
      } catch (err) {
        console.warn(
          "[SignalR Connection] Hub unavailable or initializing:",
          err,
        );
        if (isMounted) setSignalRConnected(false);
      }
    }

    initSignalR();

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
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
      if (action === "start") {
        if (!hasConsented) {
          window.electronAPI?.restoreMainWindow();
          setShowConsentModal(true);
        } else {
          const ok = await startScreenStream();
          if (ok) setSessionState("monitoring");
        }
      } else if (action === "pause") {
        handlePauseSession();
      } else if (action === "resume") {
        const ok = await startScreenStream();
        if (ok) setSessionState("monitoring");
      } else if (action === "stop") {
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
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              color: signalRConnected ? "#3fb950" : "#8b949e",
            }}
            title={
              signalRConnected
                ? "SignalR WebSockets Connected"
                : "SignalR Hub Reconnecting"
            }
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: signalRConnected ? "#3fb950" : "#8b949e",
                boxShadow: signalRConnected
                  ? "0 0 6px rgba(63, 185, 80, 0.6)"
                  : "none",
              }}
            />
            {signalRConnected ? "SignalR Live" : "SignalR Standby"}
          </span>

          <div className="system-status">
            <span className={`status-indicator status-${sessionState}`} />
            <span className="status-label">
              {sessionState === "idle" && "Session Idle"}
              {sessionState === "monitoring" && "Monitoring Active"}
              {sessionState === "paused" && "Monitoring Paused"}
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
        {/* Soft-Alert Banner (Contextual Confusion Nudge) */}
        {activeAlert && (
          <div className="soft-alert-banner" role="alert">
            <div className="soft-alert-left">
              <div className="soft-alert-icon-box">
                <AlertTriangleIcon />
              </div>
              <div>
                <div className="soft-alert-title">
                  <span>Stuck on a concept? (අවබෝධ කරගැනීමට අපහසුද?)</span>
                  <span className="soft-alert-badge">
                    {activeAlert.kind} detected
                  </span>
                </div>
                <div className="soft-alert-desc">
                  We noticed subtle cues that you might need a hand. Would you
                  like a brief explanation of what's currently on your screen?
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

        {/* Session Control Panel */}
        <section className="panel">
          <div className="panel-header">
            <div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <h2 className="panel-title">Session Management</h2>
                <span className="stream-status-badge">
                  <span
                    className={`stream-dot ${isStreamActive ? "active" : "inactive"}`}
                  />
                  {isStreamActive
                    ? "Stream: Active (In-Memory)"
                    : "Stream: Closed"}
                </span>
              </div>
              <p className="panel-description">
                Controls the active study session, continuous screen stream
                lifecycle, and live SignalR tutoring pipeline.
              </p>
            </div>
            <div className="action-row">
              {sessionState === "idle" ? (
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
                    className="btn btn-help"
                    onClick={handleTriggerQuickHelp}
                    disabled={requestingHelp}
                    title="Request immediate contextual explanation"
                  >
                    <HelpCircleIcon />{" "}
                    {requestingHelp ? "Analyzing..." : "Help Now"}
                  </button>

                  {sessionState === "monitoring" ? (
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
                  ? "Grabbing instant frames directly from in-memory stream (<50ms, zero OS prompt)."
                  : "Diagnostic one-off capture or activates automatically upon session start."}
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => handleCaptureFrame()}
              disabled={capturing}
            >
              <CameraIcon />
              {capturing
                ? "Capturing Frame..."
                : isStreamActive
                  ? "Grab Current Frame"
                  : "Capture Test Frame"}
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
                    <td>
                      {lastCapture.width} × {lastCapture.height} px
                    </td>
                    <th>Payload Size</th>
                    <td>
                      {(lastCapture.sizeBytes / 1024).toFixed(1)} KB
                      (image/jpeg)
                    </td>
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
                        ? "202 Accepted (POST /context/frame)"
                        : "Local in-memory preview"}
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
  const isFloating =
    new URLSearchParams(window.location.search).get("view") === "floating";
  return isFloating ? <FloatingWidget /> : <Dashboard />;
}

export default App;
