# Gemini model choice for Sinhala explanations

Date tested: 2026-10-28. Tested by: Pahasara. Status: preliminary; to be confirmed by the Sinhala evaluation (Appendix C of the team plan).

## Decision

| Role | Model | Env var |
| --- | --- | --- |
| Primary | `gemini-3.6-flash` | `SLC_GEMINI_MODEL` |
| Fallback | `gemini-3.5-flash-lite` | `SLC_GEMINI_FALLBACK_MODEL` |

The fallback is used when the primary answers 429 or 503, or does not answer within 25 s. Model names are pinned (no `-latest` aliases) so results stay reproducible.

## How it was tested

- The same input to each model: a 10-line `binary_search` Python snippet inside `<screen_text>` tags, with the v0 system prompt (`services/orchestrator/Prompts/system-si.txt`), temperature 0.3.
- One sample per model, so this is a first impression, not a rating.
- Availability was probed separately with a one-line prompt.

## Availability on 2026-10-28 (one key, one network)

| Model | Result |
| --- | --- |
| `gemini-3.8-flash` | 503 "high demand", or no response in 90 s |
| `gemini-3.7-flash` | no response in 30 s |
| `gemini-3.6-flash` | 200, 6.5 s (15.5 s in the quality run) |
| `gemini-3.5-flash` | 200, 9.8 s |
| `gemini-3.1-flash-lite` | 200, 2.1 s (3.3 s in the quality run) |
| `gemini-3.5-flash-lite` | 200, 1.4 s (2.4 s in the quality run) |
| `gemini-2.5-flash` | 404 although listed by the models endpoint |
| `gemini-flash-latest` | 503 |

Newest models were overloaded or hung, so the client uses a 25 s per-attempt timeout, one retry, and a fallback model.

## Sinhala observations (v0 prompt, one sample)

- `gemini-3.6-flash`: kept English technical terms in English (array, algorithm, index, return, target, lo, hi, mid), correct explanation and a correct worked example, consistent colloquial register. Slowest (about 6 to 15 s). Used Markdown headings and rules.
- `gemini-3.5-flash-lite`: correct and fast, consistent colloquial register, but transliterated some English terms into Sinhala script and translated "array". Used bold Markdown.
- `gemini-3.1-flash-lite`: correct and fast, but translated most terms and mixed colloquial and literary registers. Not chosen.

Verdict: the primary was chosen because it follows the "keep English technical terms" requirement best. When the fallback answers, term preservation will be worse; this is accepted as a degraded mode.

## Known issues and next steps

- The output contains Markdown. The prompt now asks for plain text; re-check after the change.
- Latency of the primary varies; the UI must show a working state.
- Confirm or change this choice with the 30-screen test and native-speaker ratings (Inshaf, Appendix C). Re-run the availability probe before the user study, since model availability changes.
- Privacy: only OCR text is sent. Check the AI Studio project's request-logging setting and state it in the limitations section.
