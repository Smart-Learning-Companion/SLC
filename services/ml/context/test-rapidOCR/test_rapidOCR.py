
from pathlib import Path
from ocr_service import ocr_image

# Get the directory containing this Python file
BASE_DIR = Path(__file__).resolve().parent

# Manually provided image
image_path = BASE_DIR / "img.png"

# Check whether the image exists
if not image_path.exists():
    raise FileNotFoundError(f"Image not found: {image_path}")

# Convert image into bytes
image_bytes = image_path.read_bytes()

# Extract text
result = ocr_image(image_bytes)

print("===== OCR RESULT =====")
print(result)
