"""Webcam -> MediaPipe Face Landmarker -> Eye Aspect Ratio (EAR) spike.

Headless on purpose: no cv2.imshow, so it behaves the same on Windows,
X11 and Wayland. Use --snapshot to write an annotated JPEG you can open
in any image viewer.
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

HERE = Path(__file__).parent
MODEL = HERE / "models" / "face_landmarker.task"

# Six landmarks per eye: outer corner, two upper lid, inner corner, two lower lid
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
LEFT_EYE = [362, 385, 387, 263, 373, 380]


def ear(p):
    vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    horizontal = 2.0 * np.linalg.norm(p[0] - p[3])
    return vertical / horizontal


def open_camera(index, width, height):
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_V4L2
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        cap = cv2.VideoCapture(index)  # fall back to OpenCV's default backend
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--fps", type=float, default=5, help="processing rate")
    ap.add_argument(
        "--seconds", type=float, default=0, help="stop after N seconds (0 = Ctrl+C)"
    )
    ap.add_argument(
        "--snapshot",
        action="store_true",
        help="write debug_preview.jpg once per second",
    )
    args = ap.parse_args()

    if not MODEL.exists():
        sys.exit("Model missing. Run: python download_models.py")

    landmarker = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=mpp.BaseOptions(model_asset_path=str(MODEL)),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
        )
    )

    cap = open_camera(args.camera, args.width, args.height)
    if not cap.isOpened():
        sys.exit("Cannot open camera")

    interval = 1.0 / args.fps
    wall0, cpu0 = time.perf_counter(), time.process_time()
    last_proc = last_snap = 0.0
    last_ts = -1
    processed = 0
    w = h = 0

    try:
        while True:
            now = time.perf_counter()
            if args.seconds and now - wall0 > args.seconds:
                break
            if not cap.grab():  # cheap: fetch the frame without decoding
                print("Camera stopped delivering frames")
                break
            if now - last_proc < interval:
                continue  # drop this frame
            ok, frame = cap.retrieve()
            if not ok:
                continue
            last_proc = now

            ts = int((now - wall0) * 1000)  # MediaPipe needs strictly increasing ms
            if ts <= last_ts:
                ts = last_ts + 1
            last_ts = ts

            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(image, ts)
            processed += 1

            if not result.face_landmarks:
                print("no face")
                continue

            lm = result.face_landmarks[0]
            pts = lambda idx: np.array([[lm[i].x * w, lm[i].y * h] for i in idx])
            right, left = pts(RIGHT_EYE), pts(LEFT_EYE)
            value = (ear(right) + ear(left)) / 2
            print(f"EAR {value:.3f}")

            if args.snapshot and now - last_snap >= 1.0:
                for x, y in np.vstack([right, left]).astype(int):
                    cv2.circle(frame, (int(x), int(y)), 2, (0, 255, 0), -1)
                cv2.putText(
                    frame,
                    f"EAR {value:.3f}",
                    (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1,
                    (0, 255, 0),
                    2,
                )
                cv2.imwrite(str(HERE / "debug_preview.jpg"), frame)
                last_snap = now
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        wall = time.perf_counter() - wall0
        cpu = time.process_time() - cpu0
        print(
            f"\n{processed} frames processed in {wall:.1f}s at {w}x{h}, "
            f"avg CPU ~{100 * cpu / wall:.0f}% of one core"
        )


if __name__ == "__main__":
    main()
