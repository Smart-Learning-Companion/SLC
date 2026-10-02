# AI context block

Paste this at the start of any AI chat:

    Project: Smart Learning Companion. Desktop app: webcam features (local) -> confirmed
    confusion/drowsiness (8 s) -> Electron screen frame -> OCR -> Gemini explains in Sinhala, keeping
    English technical terms. Privacy: frames never leave the device; only OCR text goes to the LLM.
    Stack: Electron + React (UI, screen capture, starts .NET) <-> .NET 10 orchestrator (REST +
    SignalR, SQLCipher, decision layer, Gemini client) <-> Python 3.12 ML service (MediaPipe,
    FER+ ONNX, EAR, OCR). Prefer Electron/.NET built-ins over OS-specific tools.
    Platforms: Windows and Linux Wayland only (no X11). CPU only, <15% of one core.
    Team of 3, 12 weeks, keep everything simple and minimal.
    My role: <fill in>. My current task: <fill in>.

Never paste API keys into AI chats.
