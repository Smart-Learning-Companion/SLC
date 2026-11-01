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
7. `SLC_DEV=1`: services are started by hand. The orchestrator does not launch Python and accepts the dev token `dev` when `SLC_TOKEN` is unset. Without `SLC_DEV`, `SLC_TOKEN` is required.

## Environment variables

| Variable | Set by | Used by | Meaning | Default |
| --- | --- | --- | --- | --- |
| `SLC_TOKEN` | Electron | orchestrator, ML | Shared bearer token | required unless `SLC_DEV=1` |
| `SLC_PORT` | Electron | orchestrator | Orchestrator port (ML sees it as `SLC_ORCH_PORT`) | 8100 |
| `SLC_ML_PORT` | Electron | orchestrator, ML | ML service port | 8200 |
| `SLC_DATA_DIR` | Electron | orchestrator | Data folder (`app.getPath('userData')`) | none |
| `SLC_DB_KEY` | Electron | orchestrator | SQLCipher key from safeStorage | none |
| `SLC_PYTHON` | optional | orchestrator | Python interpreter | `<SLC_ML_DIR>/.venv/bin/python` or `Scripts\python.exe` |
| `SLC_ML_DIR` | Electron | orchestrator | ML service folder; **required when not started via `dotnet run` from services/orchestrator** | `../ml` from the orchestrator's content root |
| `SLC_DEV` | developer | orchestrator | `1` = start services by hand | unset |
| `SLC_WATCHDOG` | orchestrator | ML | `1` = ML exits if the orchestrator stops answering `/health` | unset |

Limits: there is no auto-restart if Python crashes (logged only).
