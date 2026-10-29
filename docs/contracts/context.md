# Screen frame and OCR

## POST /context/frame  (UI -> .NET)
Sent only after a `captureRequest` event (see signalr-events.md).

Headers: `Authorization: Bearer <token>`, `Content-Type: image/jpeg`,
`X-Request-Id: <requestId from captureRequest>`.
Body: raw JPEG bytes. Response: `202 Accepted` immediately, or `400` if the body is empty.
The frame stays in memory. It is never saved or uploaded.
The result is not in the response. It arrives later as an `explanation` event with the same `requestId`.

Pipeline: .NET -> Python /context/ocr -> Gemini (text only) -> `explanation`.
One request runs at a time. A second request while one is running gets an immediate
`explanation` event with `language: "en"` and the text "Still working on the previous request."
Failures also arrive as `explanation` events with `language: "en"` (could not read the screen,
no readable text found, could not generate an explanation).

## POST /context/ocr  (.NET -> Python)
Headers: `Authorization: Bearer <token>`, `Content-Type: image/jpeg`.
Body: raw image bytes. Response `200 application/json`:

    {
      "text": "def binary_search(arr, target):\n    ...",
      "confidence": 0.91,
      "durationMs": 840
    }

On failure: `500` with `{"error": "..."}`. If no text is found, return `"text": ""`.
