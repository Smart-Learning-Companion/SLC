"""Download the MediaPipe face landmarker model into ./models (git-ignored)."""
import urllib.request
from pathlib import Path

URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)
dest = Path(__file__).parent / "models" / "face_landmarker.task"
dest.parent.mkdir(exist_ok=True)

if dest.exists():
    print(f"Already downloaded: {dest}")
else:
    print("Downloading face landmarker model...")
    urllib.request.urlretrieve(URL, dest)
    print(f"Saved to {dest}")
