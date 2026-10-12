"""Webcam -> MediaPipe -> features, posted to the orchestrator. Headless.

Runs only between start() and stop(); stop() releases the camera.
v0 fills EAR and blink rate. FER+, brow, mouth and head pose arrive in Week 3.
"""

import json
import sys
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

MODEL = Path(__file__).parent / "models" / "face_landmarker.task"
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
LEFT_EYE = [362, 385, 387, 263, 373, 380]
BLINK_EAR = 0.20  # provisional threshold; the calibration step replaces it


def ear(p):
    vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    return vertical / (2.0 * np.linalg.norm(p[0] - p[3]))


def open_camera(index, width, height):
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_V4L2
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


class PerceptionWorker:
    def __init__(self, post_url, token, fps=5, camera=0, width=640, height=480):
        self.post_url, self.token = post_url, token
        self.fps, self.camera, self.width, self.height = fps, camera, width, height
        self._thread = None
        self._stop = threading.Event()

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self._thread = None

    def _post(self, payload):
        req = urllib.request.Request(
            self.post_url,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        try:
            urllib.request.urlopen(req, timeout=1).close()
        except Exception as e:  # never let a network hiccup kill the camera loop
            print("post failed:", e)

    def _run(self):
        landmarker = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=mpp.BaseOptions(model_asset_path=str(MODEL)),
                running_mode=vision.RunningMode.VIDEO,
                num_faces=1,
            )
        )
        cap = open_camera(self.camera, self.width, self.height)
        if not cap.isOpened():
            print("cannot open camera")
            landmarker.close()
            return

        interval = 1.0 / self.fps
        t0 = time.perf_counter()
        last_proc, last_ts = 0.0, -1
        blinks, was_closed = deque(), False
        try:
            while not self._stop.is_set():
                now = time.perf_counter()
                if not cap.grab():
                    break
                if now - last_proc < interval:
                    continue
                ok, frame = cap.retrieve()
                if not ok:
                    continue
                last_proc = now
                ts = max(int((now - t0) * 1000), last_ts + 1)
                last_ts = ts

                h, w = frame.shape[:2]
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = landmarker.detect_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts
                )

                payload = {
                    "t": time.time(),
                    "faceFound": False,
                    "fer": None,
                    "ear": None,
                    "blinkRate": None,
                    "browFurrow": None,
                    "mouthOpen": None,
                    "headPitch": None,
                    "headYaw": None,
                    "states": None,
                }
                if result.face_landmarks:
                    lm = result.face_landmarks[0]
                    pts = lambda idx: np.array(
                        [[lm[i].x * w, lm[i].y * h] for i in idx]
                    )
                    value = (ear(pts(RIGHT_EYE)) + ear(pts(LEFT_EYE))) / 2
                    closed = value < BLINK_EAR
                    if was_closed and not closed:
                        blinks.append(now)
                    was_closed = closed
                    while blinks and now - blinks[0] > 60:
                        blinks.popleft()
                    window = min(
                        60.0, max(now - t0, 5.0)
                    )  # avoids a wild rate in the first seconds
                    payload.update(
                        faceFound=True,
                        ear=round(float(value), 4),
                        blinkRate=round(len(blinks) * 60 / window, 1),
                    )
                self._post(payload)
        finally:
            cap.release()
            landmarker.close()
