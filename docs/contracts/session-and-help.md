# Session, help, alerts and analytics  (UI -> .NET)

All requests carry `Authorization: Bearer <token>`.

| Request | Body | Response |
|---|---|---|
| POST /session/start | `{}` | `200 {"sessionId": "..."}` |
| POST /session/pause | `{}` | `204` |
| POST /session/stop | `{}` | `204` |
| POST /help/now | `{}` | `202` (starts the quick-help flow) |
| POST /alerts/{id}/response | `{"accepted": true}` | `204` (Yes / Not now) |
| GET /analytics/timeline?sessionId= | none | `200 [{"t": 1760000000, "state": "focused"}]` |
| GET /analytics/summary?sessionId= | none | `200 {"focusedPct": 0.7, "alerts": 4, "accepted": 3}` |
| GET /health | none | `200 {"status": "ok"}` (no token needed) |

Starting a session also tells Electron to open the screen stream. Pause and stop close it.
