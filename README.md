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

Windows: `winget install Git.Git OpenJS.NodeJS.LTS Microsoft.DotNet.SDK.10 Python.Python.3.12`
Arch: `sudo pacman -S git nodejs npm dotnet-sdk` and Python 3.12 from the AUR (`python312`).

Python service (from `services/ml/`):

    py -3.12 -m venv .venv          (Windows)
    python3.12 -m venv .venv        (Linux)
    pip install -r requirements.txt

## Workflow

1. Never push to `main`. Create a branch: `yourname/short-topic`.
2. Commit messages: `type: short description` (feat, fix, docs, chore, test, refactor).
3. Open a pull request. Say what changed, why, and how you tested it.
4. Pahasara reviews and merges. One owner per folder (see CODEOWNERS).
5. Never commit keys, `.env` files, or volunteer data.

Rhythm: Monday 20-minute sync, Thursday chat check-in, Sunday night push working code.
Full plan: see the team plan PDF. Contracts: `docs/contracts/`.
