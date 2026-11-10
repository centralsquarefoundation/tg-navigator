# Archived inspiration: teacher-guide-navigator (UP)

mobile-tg-maker was built from ideas in **https://github.com/anustup-nayak/teacher-guide-navigator**
(commit `5b2cb437e925c8c64f6eb2f52ce0dfc6f29973b5`, 1 Nov 2026): a hand-built, UP-only
lesson companion for the UP Mathematics and Hindi Teacher Guides, Grades 1–3.

**That repository is archived inspiration, not part of this project.** Do not edit it, build it,
deploy it or follow its AGENTS.md/HANDOFF.md rules here. A local copy may exist in
`_inspiration/teacher-guide-navigator/` (git-ignored, marked with `ARCHIVED-INSPIRATION.md`).

## What we took

| Taken | Where it lives now | Changed |
|---|---|---|
| Legacy Hindi font decoders (Kruti Dev family, Chanakya, BHARTIYA, SuperHindi) | `engine/fonts/` | Chanakya त्र and फ fixes, colon-after-digit fix (Haryana) |
| Noto Sans Devanagari / Noto Sans fonts (OFL) | `app/fonts/` | none |
| Teaching flow: आज · पूरा साल · सभी पाठ tabs, grade/subject pickers, lesson anatomy (banner → chips → sections → my note → “पढ़ा दिया है” → original pages), device-only teacher data | `app/` | rewritten as one data-driven app; CSF branding |
| Type and touch rules (17px body, ≥48px controls, no text < 13px, 320px no scroll) | `app/styles.css` | CSF palette instead of UP palette |
| Principles: keep source wording, every lesson keeps its original page, never claim academic sign-off | everywhere | — |

## What we did not take, and why

- **Per-PDF parsers with fixed coordinates and Hindi regexes** (`parse_guides.py`, `extract_guides.py`):
  every state's layout differs, so layout knowledge now lives in a per-state profile read by a
  vision transcriber, not in code.
- **UP-specific app code** (`useUPStageLabels`, I do/We do/You do stage names, week/day hard-wiring,
  review-week page numbers, per-lesson crop rectangles).
- **Committed content releases and PDFs** (the UP repo is ~640 MB): here PDFs stay outside git
  and only transcriptions (small JSON) are committed; the site is regenerated.
- The heavy multi-agent governance (design lock, handoff log): replaced by automatic checks plus an
  optional review report.
