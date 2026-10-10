from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()

image_path = "img.png"

result, elapsed = ocr(image_path)

print("\n===== OCR RESULT =====")

for item in result:
    box, text, confidence = item
    print(f"Text: {text}")
    print(f"Confidence: {float(confidence): .4f}")
    print(f"Box: {box}")
    print("-" * 40)

print(f"\nProcessing time: {elapsed}")
