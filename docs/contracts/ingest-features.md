# POST /ingest/features  (Python -> .NET, about 5 per second)

Header: `Authorization: Bearer <token>`
Body: `application/json`. Response: `204 No Content`.

    {
      "t": 1760000000.123,
      "faceFound": true,
      "fer": {
        "neutral": 0.62, "happiness": 0.05, "surprise": 0.03, "sadness": 0.08,
        "anger": 0.04, "disgust": 0.01, "fear": 0.02, "contempt": 0.15
      },
      "ear": 0.29,
      "blinkRate": 14.0,
      "browFurrow": 0.12,
      "mouthOpen": 0.03,
      "headPitch": -4.2,
      "headYaw": 7.9,
      "states": null
    }

Rules:
- `t` is Unix seconds (float).
- If `faceFound` is false, every numeric field is `null`.
- `fer` uses named keys, so the model's class order never matters on the wire.
- `blinkRate` is blinks per minute over the last 60 s.
- `states` is `null` until a trained model is loaded, then:
  `{"focused": 0.7, "confused": 0.2, "drowsy": 0.1}`.
- Only these numbers leave Python. No images, ever.
