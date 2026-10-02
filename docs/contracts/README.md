# Contracts (DRAFT, finalised by G1, Oct 7)

All local services bind to 127.0.0.1. Every request carries the session token.

| Direction | Endpoint / event | Payload |
|---|---|---|
| Python -> .NET | POST /ingest/features (~5/s) | time, face found, 8 FER+ probabilities, EAR, blink rate, brow furrow, mouth open, head pitch/yaw, state probabilities or null |
| UI -> .NET | POST /context/frame | screen frame as JPEG bytes, sent when .NET asks |
| .NET -> Python | POST /context/ocr | image bytes in; text, OCR confidence, duration out |
| UI -> .NET | POST /session/start, /session/pause, /session/stop, POST /help/now, GET /analytics/timeline, GET /analytics/summary | small JSON bodies |
| .NET -> UI (SignalR) | softAlert, captureRequest, explanation, status | alert kind; frame request; explanation text and language; state and CPU |

Config: `config.json` at repo root (thresholds, 8 s window, cooldown, fps).

Each endpoint gets its own file with example JSON in this folder. Owner: Pahasara.
