# Launch and token flow

1. Electron generates a token (`crypto.randomBytes(32).toString("hex")`) and picks two free
   localhost ports: one for .NET, one for Python.
2. Electron spawns .NET with env: `SLC_TOKEN`, `SLC_PORT`, `SLC_ML_PORT`, `SLC_DATA_DIR`.
3. .NET spawns Python (`services/ml/.venv` interpreter, `SLC_PYTHON` overrides the path)
   with env: `SLC_TOKEN`, `SLC_ML_PORT`, `SLC_ORCH_PORT`.
4. Electron polls `GET /health` on .NET until it answers, then shows the UI.
5. Everything binds to `127.0.0.1` only. Every request except `/health` needs
   `Authorization: Bearer <token>`.
6. Quitting Electron stops .NET; .NET stops Python on shutdown.
7. `SLC_DEV=1`: services are started by hand and read the same env vars.

The token lives only in process env and memory. Never log it.
