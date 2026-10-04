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
    docs/                     contracts, notes, AI_CONTEXT

## Setup

Windows: `winget install Git.Git OpenJS.NodeJS.LTS Microsoft.DotNet.SDK.10 Python.Python.3.14`
Arch: `sudo pacman -S git nodejs npm dotnet-sdk python`.

Python service (from `services/ml/`):

    py -3.14 -m venv .venv          (Windows)
    python -m venv .venv            (Linux)
    pip install -r requirements.txt

## Workflow

1. Never push to `main`. Create a branch: `yourname/short-topic`.
2. Commit messages: `type: short description` (feat, fix, docs, chore, test, refactor).
3. Open a pull request. Say what changed, why, and how you tested it.
4. Pahasara reviews and merges. One owner per folder (see CODEOWNERS).
5. Never commit keys, `.env` files, or volunteer data.

Rhythm: Monday 20-minute sync, Thursday chat check-in, Sunday night push working code.
Full plan: see the team plan PDF. Contracts: `docs/contracts/`.

## Python service notes

- Python 3.14 (decision: worked on Arch/ Windows).
- After `pip install -r requirements.txt`, swap OpenCV:
  `pip uninstall -y opencv-python opencv-contrib-python opencv-contrib-python-headless opencv-python-headless`
  then `pip install opencv-python-headless`.
  Reason: dependencies pull in the GUI OpenCV builds, which crash on Wayland and are not needed in a headless service.
- Never call `cv2.imshow` in service code. For debugging, write an image to disk.
- Download models with `python download_models.py` (files are git-ignored).
- Run scripts with the venv interpreter: `../.venv/bin/python` (Linux), `..\.venv\Scripts\python.exe` (Windows).
