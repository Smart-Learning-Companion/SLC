"""Fake feature stream at 5/s. Run: python fake_features.py [url]"""
import json
import math
import os
import sys
import time
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/ingest/features"
TOKEN = os.environ.get("SLC_TOKEN", "dev")

start = time.time()
while True:
    t = time.time()
    phase = (t - start) % 60                   # 40 s "focused", 20 s "confused"
    confused = phase > 40
    body = {
        "t": t,
        "faceFound": True,
        "fer": {"neutral": 0.6, "happiness": 0.05, "surprise": 0.05 if confused else 0.02,
                "sadness": 0.1, "anger": 0.05, "disgust": 0.01, "fear": 0.04, "contempt": 0.1},
        "ear": 0.30 + 0.03 * math.sin(t),
        "blinkRate": 14.0,
        "browFurrow": 0.6 if confused else 0.1,
        "mouthOpen": 0.03,
        "headPitch": -4.0,
        "headYaw": 8.0,
        "states": None,
    }
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    try:
        urllib.request.urlopen(req, timeout=2)
    except Exception as e:
        print("post failed:", e)
    time.sleep(0.2)
