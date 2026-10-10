# SignalR  (.NET -> UI), hub at /hub

The UI connects with `accessTokenFactory` (the token goes in the `access_token`
query string for WebSockets; browsers cannot set headers on a WebSocket).

| Event | Payload |
|---|---|
| status | `{"state": "idle" or "monitoring" or "paused", "cpuPercent": 7.5}` |
| softAlert | `{"alertId": "a1", "kind": "confusion" or "drowsiness", "t": 1760000000}` |
| captureRequest | `{"requestId": "r1"}` |
| explanation | `{"requestId": "r1", "text": "...", "language": "si" or "en"}` |

Flow for quick-help: UI calls POST /help/now, .NET sends `captureRequest`, UI posts the frame
to /context/frame, .NET forwards it to Python /context/ocr, then Gemini, then `explanation`.
