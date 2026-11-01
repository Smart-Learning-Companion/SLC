# Smart Learning Companion

A proactive AI tutor that detects student confusion before they ask for help.
University of Sri Jayewardenepura, Faculty of Technology. Research project.

Team: Pahasara (lead, backend + perception), Avishka (frontend + model training), Inshaf (data, context + evaluation).

## Layout

    apps/desktop/             Electron + React + TypeScript (Avishka)
    services/orchestrator/    .NET 10 (Pahasara)
    services/ml/perception/   webcam, MediaPipe, FER+, EAR (Pahasara)
    services/ml/context/      OCR, image bytes to text (Inshaf)
    research/collection/      recorder and protocol tools
    research/training/        notebooks, metrics (Avishka)
    research/evaluation/      surveys, Sinhala test set (Inshaf)
    tools/                    dev tools (SignalR listener)
    docs/                     contracts, notes, dev setup

## Setup

Windows: `winget install Git.Git OpenJS.NodeJS.LTS Microsoft.DotNet.SDK.10 Python.Python.3.14`
Arch: `sudo pacman -S git nodejs npm dotnet-sdk python`

Python service, from `services/ml/`:

    py -3.14 -m venv .venv            (Windows)      python -m venv .venv            (Linux)
    pip install -r requirements.txt   (venv active)
    pip uninstall -y opencv-python opencv-contrib-python opencv-contrib-python-headless opencv-python-headless
    pip install opencv-python-headless
    python perception/download_models.py

The OpenCV swap is needed because dependencies pull in GUI builds that crash on Wayland. Never call `cv2.imshow` in service code.

## Gemini key (never commit keys)

Create your own key at https://aistudio.google.com/apikey and keep it in a file outside the repo.

Linux, `~/.config/slc/dev.env` (`chmod 600`), load with `source ~/.config/slc/dev.env`:

    export GEMINI_API_KEY='...'
    export SLC_GEMINI_MODEL='...'
    export SLC_GEMINI_FALLBACK_MODEL='...'     # optional

Windows, `$HOME\.config\slc\dev.ps1`, load with `. $HOME\.config\slc\dev.ps1`:

    $env:GEMINI_API_KEY='...'
    $env:SLC_GEMINI_MODEL='...'
    $env:SLC_GEMINI_FALLBACK_MODEL='...'

Load it in every terminal that starts the orchestrator or Electron. Current model choice: `docs/spikes/gemini-model-choice.md`.
Test a model before using it: `docs/dev-setup.md`. Only OCR text is sent to Gemini, never images.

## Run (dev)

    cd services/orchestrator
    SLC_TOKEN=dev dotnet run                       (Linux)
    $env:SLC_TOKEN="dev"; dotnet run               (Windows PowerShell)

Starts the orchestrator on 127.0.0.1:8100, which also starts the Python service. Set `SLC_DEV=1` to start services by hand.
See SignalR events: `dotnet run tools/listen.cs`. Desktop app: `apps/desktop/README.md`.
Contracts: `docs/contracts/`. Mocks: `services/ml/mocks/`. More commands (test a frame, check processes): `docs/dev-setup.md`.

## Workflow

1. Never push to `main`. Branch: `yourname/short-topic`.
2. Commits: `type: short description` (feat, fix, docs, chore, test, refactor).
3. Open a pull request: what changed, why, how you tested it.
4. Pahasara reviews and merges. One owner per folder (see CODEOWNERS).
5. Never commit keys, `.env` files, or volunteer data.
