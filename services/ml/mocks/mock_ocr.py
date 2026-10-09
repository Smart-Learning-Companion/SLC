"""Fake /context/ocr endpoint. Run: python mock_ocr.py"""
import os

import uvicorn
from fastapi import FastAPI, HTTPException, Request

TOKEN = os.environ.get("SLC_TOKEN", "dev")
app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/context/ocr")
async def ocr(request: Request):
    if request.headers.get("authorization") != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401)
    data = await request.body()
    return {
        "text": "def binary_search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    ...",
        "confidence": 0.9,
        "durationMs": 5,
        "receivedBytes": len(data),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("SLC_ML_PORT", 8200)))
