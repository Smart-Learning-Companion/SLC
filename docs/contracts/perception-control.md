# Perception control  (.NET -> Python)

Headers: `Authorization: Bearer <token>`.

| Request | Response |
|---|---|
| POST /perception/start | `200 {"running": true}` |
| POST /perception/stop | `200 {"running": false}` |
| GET /health | `200 {"status": "ok"}` (no token needed) |

Python opens the webcam only between start and stop. Stop releases the camera (the light goes off).
While running, Python posts features to `http://127.0.0.1:$SLC_ORCH_PORT/ingest/features`.
