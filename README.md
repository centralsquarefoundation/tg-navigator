# TG Navigator — teacher guides to a mobile lesson app, for any state

- **Live (Haryana):** https://centralsquarefoundation.github.io/tg-navigator/haryana/
- **Add a state (MP, …):** follow [docs/NEW_STATE.md](docs/NEW_STATE.md) — a new folder `states/<state>/`, no app or engine code.

Turns a state's printed **Teacher Guide PDFs** into a **mobile lesson app** for teachers: pick
class and subject, see today's lesson, browse the year by week/chapter, open a day's plan with its
periods, steps and timings, mark it taught, keep notes, and open the original guide page behind
every lesson. One shared app and engine; everything state-specific is configuration.

First state: **Haryana 2026–27** (Mathematics G1–3, Hindi G1–3, Balvatika-3), CSF-branded with the
Haryana Government and NIPUN Haryana logos.

```
PDFs ──render──► page images ──vision transcription (per-state profile)──► page JSON
      ──text layer (where one exists)──────────────────────────────┐          │
                                                                    ▼          ▼
                         assemble (keys, continuation) ► reconcile (2nd reading) ► verify (sequence, numbering…)
                                                                    ► publish (app + data) ► review report (optional)
```

## Layout

| Path | What |
|---|---|
| `engine/` | Generic pipeline (Python 3.11+, PyMuPDF, Pillow). No state knowledge. |
| `engine/prompts/transcribe.md` | Shared transcription instructions for vision models |
| `engine/fonts/` | Legacy Hindi font decoders (Kruti/Chanakya family) |
| `app/` | The teacher app: buildless HTML/JS/CSS, offline-capable, data-driven |
| `states/<state>/state.json` | Documents, guides, page ranges, branding |
| `states/<state>/guides/*.profile.json` | How a guide family prints its keys/headings (+ which checks apply) |
| `states/<state>/anomalies.json` | Source misprints confirmed on the page image (with evidence) |
| `states/<state>/work/vision/` | Committed transcriptions (one JSON per PDF page) |
| `states/<state>/work/packs/`, `checks/` | Assembled lessons and check results |
| `build/<state>/site/` | Generated, deployable site (git-ignored) |
| `docs/NEW_STATE.md` | How to add the next state; what is reusable vs per-state |
| `INSPIRATION.md` | The archived UP project this grew from (not part of this repo) |

## Rebuild Haryana

```sh
set TG_SOURCES=C:\path\to\pdfs                    # folder with the guide PDFs (default: Downloads)
python engine/render.py haryana                    # page images (once)
python engine/pipeline.py haryana                  # textlayer → assemble → reconcile → verify → publish → review
python -m http.server 8765 --directory build/haryana/site   # open http://localhost:8765
```

Transcriptions are already committed; `engine/jobs.py` only produces sheets for missing pages.

## How correctness is guarded

1. **Keys come from the page's own print** (week band + highlighted day tab; chapter band + Day badge),
   with the evidence recorded per lesson.
2. **Sequence checks**: every week has days 1–6 once and in order; chapter day-ranges are contiguous;
   chapter names must appear in the guide's academic plan. Errors block publishing.
3. **Second reading** against the PDF text layer where one exists (Hindi G2/G3): agreement is
   measured and differences are flagged, never silently applied.
4. **Confirmed source misprints** (e.g. Hindi G3 pp139–142 print “सप्ताह-11” inside week 20) are
   recorded with evidence and shown to teachers on the lesson.
5. **Every lesson shows its original page(s)**; the optional review report (`/review/`) puts each
   lesson's outline beside its page for a human tick.

## Deploy

`build/<state>/site/` is a static site (~130 MB with page images). Any static host works.
Haryana is on GitHub Pages: `python engine/deploy_pages.py` copies every built state to the
`gh-pages` branch (one fresh commit each time, so the repo does not grow) at `<state>/`, with a root
page listing the states. Pages serves that branch at `https://<owner>.github.io/<repo>/<state>/`.
The guides' copyright stays with the state.
