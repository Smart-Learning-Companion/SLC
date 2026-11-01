"""ML service: perception control + OCR. Run from services/ml: python app.py"""

import os
import threading
import time
import urllib.request
from contextlib import asynccontextmanager

import uvicorn
from context.ocr import ocr_image_ex, warm_up
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from perception.worker import PerceptionWorker

TOKEN = os.environ.get("SLC_TOKEN", "dev")
ML_PORT = int(os.environ.get("SLC_ML_PORT", 8200))
ORCH_PORT = int(os.environ.get("SLC_ORCH_PORT", 8100))
CAMERA = int(
    os.environ.get("SLC_CAMERA", 0)
)  # change if the wrong camera opens (see v4l2-ctl --list-devices)

worker = PerceptionWorker(
    f"http://127.0.0.1:{ORCH_PORT}/ingest/features", TOKEN, camera=CAMERA
)


def _warm_ocr():
    try:
        warm_up()
        print("OCR: models loaded", flush=True)
    except Exception as e:
        print(f"WARNING: OCR could not load: {e}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(
        target=_warm_ocr, daemon=True
    ).start()  # load OCR models without delaying startup
    yield
    worker.stop()  # always release the camera on shutdown


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def require_token(request: Request, call_next):
    if (
        request.url.path != "/health"
        and request.headers.get("authorization") != f"Bearer {TOKEN}"
    ):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/perception/start")
def perception_start():
    worker.start()
    return {"running": True}


@app.post("/perception/stop")
def perception_stop():
    worker.stop()
    return {"running": False}


@app.post("/context/ocr")
async def context_ocr(request: Request):
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="empty body")
    t0 = time.perf_counter()
    out = await run_in_threadpool(
        ocr_image_ex, data
    )  # keep the event loop free while OCR runs
    return {
        "text": out.text,
        "confidence": round(out.confidence, 3),
        "durationMs": round((time.perf_counter() - t0) * 1000),
    }


def watch_orchestrator():
    """Exit if the orchestrator stops answering, so an orphaned service never keeps the camera on."""
    failures = 0
    while True:
        time.sleep(5)
        try:
            urllib.request.urlopen(
                f"http://127.0.0.1:{ORCH_PORT}/health", timeout=2
            ).close()
            failures = 0
        except Exception:
            failures += 1
            if failures >= 3:  # about 15 s of silence
                worker.stop()
                os._exit(0)


if __name__ == "__main__":
    if os.environ.get("SLC_WATCHDOG") == "1":
        threading.Thread(target=watch_orchestrator, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=ML_PORT)
