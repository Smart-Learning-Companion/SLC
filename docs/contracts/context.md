# Screen frame and OCR

## POST /context/frame  (UI -> .NET)
Sent only after a `captureRequest` event (see signalr-events.md).

Headers: `Authorization: Bearer <token>`, `Content-Type: image/jpeg`,
`X-Request-Id: <requestId from captureRequest>`.
Body: raw JPEG bytes. Response: `202 Accepted`.
The frame stays in memory. It is never saved or uploaded.

## POST /context/ocr  (.NET -> Python)
Headers: `Authorization: Bearer <token>`, `Content-Type: image/jpeg`.
Body: raw image bytes. Response `200 application/json`:

    {
      "text": "def binary_search(arr, target):\n    ...",
      "confidence": 0.91,
      "durationMs": 840
    }

On failure: `500` with `{"error": "..."}`. If no text is found, return `"text": ""`.
