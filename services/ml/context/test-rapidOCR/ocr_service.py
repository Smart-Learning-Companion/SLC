
import io
import re
import numpy as np

from PIL import Image, ImageOps, ImageFilter
from rapidocr_onnxruntime import RapidOCR

# Initialize OCR engine
ocr = RapidOCR()


def preprocess_image(image_bytes: bytes):

    image = Image.open(io.BytesIO(image_bytes))

    # Convert to grayscale
    image = ImageOps.grayscale(image)

    # Increase contrast automatically
    image = ImageOps.autocontrast(image)

    # Apply light noise reduction
    image = image.filter(ImageFilter.MedianFilter(size=3))

    return np.array(image)


def clean_text(text: str):

    # Remove repeated spaces
    text = re.sub(r"[ \t]+", " ", text)

    # Remove excessive empty lines
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def ocr_image(image_bytes: bytes) -> str:

    processed_image = preprocess_image(image_bytes)

    result, elapsed = ocr(processed_image)

    if not result:
        return ""

    lines = [item[1] for item in result]

    extracted_text = "\n".join(lines)

    return clean_text(extracted_text)
