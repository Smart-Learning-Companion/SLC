from fastapi import FastAPI, File, UploadFile

from services.ml.context.ocr.ocr_service import ocr_image

app = FastAPI()


@app.get("/")
def root():
    return {"service": "OCR Service", "status": "running"}


@app.post("/context/ocr")
async def context_ocr(file: UploadFile = File(...)):
    image_bytes = await file.read()

    return {
        "result": ocr_image(image_bytes),
        "success": True,
        "filename": file.filename,
        "size": len(image_bytes),
    }
