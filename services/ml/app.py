"""ML service: perception control + OCR. Run from services/ml: python app.py"""

import os
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from perception.worker import PerceptionWorker

TOKEN = os.environ.get("SLC_TOKEN", "dev")
ML_PORT = int(os.environ.get("SLC_ML_PORT", 8200))
ORCH_PORT = int(os.environ.get("SLC_ORCH_PORT", 8100))

try:
    from context.ocr import ocr_image  # Inshaf's module: ocr_image(bytes) -> str
except ImportError:

    def ocr_image(data: bytes) -> str:  # stand-in until his module lands
        return "def binary_search(arr, target):\n    ..."


worker = PerceptionWorker(f"http://127.0.0.1:{ORCH_PORT}/ingest/features", TOKEN)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    worker.stop()  # always release the camera on shutdown


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def require_token(request: Request, call_next):
    if (
        request.url.path != "/health"
        and request.headers.get("authorization") != f"Bearer {TOKEN}"
    ):
        from fastapi.responses import JSONResponse

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
    text = ocr_image(data)
    return {
        "text": text,
        "confidence": 0.0,
        "durationMs": round((time.perf_counter() - t0) * 1000),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=ML_PORT)
