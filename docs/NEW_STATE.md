# Converting a new state's teacher guides into the app

Goal: an operator (a person + Claude Code) hands over a state's Teacher Guide PDFs and gets a
mobile web app with every lesson placed under the right week/day/chapter/heading, each linked to
its original page, plus a report showing what was checked. Expect every state to look different.

## What is reusable vs. what each state needs

| Step | Reusable as is | Per state (expected work) |
|---|---|---|
| Render pages | `engine/render.py` | — |
| Text layer + legacy fonts | `engine/textlayer.py`, `engine/fonts/` | A new legacy font may need a decoder rule (measure with reconcile) |
| Structure audit | — | **~1–2 h**: look at contact sheets + a few pages, write `state.json` (documents, guides, page ranges) and one `guides/<subject>.profile.json` per layout family |
| Transcription | `engine/jobs.py`, `engine/prompts/transcribe.md` | Run the job sheets with vision subagents (Claude Code) — compute, not people |
| Assembly | `engine/assemble.py` (profile-driven: keys, grouping, continuation, restarts) | Nothing, if the profile names the keys correctly |
| Checks | `engine/verify.py` (sequence, duplicates, numbering, minutes, coverage, plan cross-check) | Set `checks` in the profile (`week-day` or `chapter-days` today; add a new sequence type only if a state uses another calendar) |
| Source misprints | mechanism in `assemble.py`/`verify.py` | Confirm each flagged anomaly on the page image and record it in `anomalies.json` |
| App | `app/` (one runtime for all states) | `brand` block in `state.json` (colours, logos), labels in profiles |
| Review report | `engine/review.py` | Optional: a person ticks placements |

## Steps

1. **Collect PDFs** in one folder (outside the repo). `set TG_SOURCES=<folder>` or pass `--sources`.
2. **Create `states/<state>/state.json`**: copy `states/haryana/state.json`; list `documents`
   (file names) and `guides` (grade, subject, profile, page ranges: `plan`, `lessons`, `guide`).
   One PDF can hold several guides (Haryana Hindi G1 also holds Balvatika-3).
3. **Render**: `python engine/render.py <state>`. Look at contact sheets of each guide
   (`_work/wsheet.py` style) to find where lessons start/end and how a page marks its place.
4. **Write the profile(s)** (`states/<state>/guides/*.profile.json`):
   - `hierarchy.keys`: the printed location keys, in order (e.g. `["week","day"]`, `["chapter","days"]`).
   - `hierarchy.group_by`: the key that groups lessons in the app.
   - `layout_notes`: plain sentences telling the transcriber exactly how this guide prints those
     keys, its heading levels, columns, boxes to ignore or keep. **This is where layout knowledge
     goes — never in code.**
   - `checks`: `key_pattern`, `sequence`, `days_per_week`, `expect_one_unit_per_lesson_page`.
5. **Pilot**: `python engine/jobs.py <state> --guide <id> --pages <2 typical pages> --tag=-pilot`,
   run one transcriber, read the JSON, adjust `layout_notes`. Delete the pilot JSON if the notes changed a lot.
6. **Transcribe all**: `python engine/jobs.py <state> --guide <id> --part plan` and `--part lessons`,
   then give each job sheet to a vision subagent (prompt used for Haryana: "Read the job sheet …
   follow it exactly … use only Read and Write"). ~10 pages per agent, run many in parallel.
   Re-running `jobs.py` only lists pages still missing.
7. **Pipeline**: `python engine/pipeline.py <state>` (textlayer → assemble → reconcile → verify →
   publish → review). Publishing refuses guides with errors.
8. **Fix every error** (and look at warnings): open the page image; either fix the transcription
   JSON (re-run that page) or, if the page itself is misprinted, add an entry to
   `states/<state>/anomalies.json` with evidence (and a `keys` correction + teacher-facing `notice`
   if placement depends on it). Re-run the pipeline.
9. **Deploy** `build/<state>/site/` (see README).
10. **Optional human review**: share `…/review/index.html`; reviewers tick lessons and download a
    JSON; drop it in `states/<state>/reviews/` and re-run `engine/review.py`.

## Lessons from Haryana (Nov 2026)

- Math PDFs had **no text layer at all** (text drawn as vector outlines); Hindi G2/G3 used the
  legacy **Walkman-Chanakya** font; Hindi G1 mostly outlines. Vision transcription was the only
  path that works for every page; the text layer is a checker.
- The decoded text layer is **not** automatically more accurate: on Hindi G2 the bold Chanakya
  font decoded लेखन as लेऽन. Keep `textlayer_policy` at `check` unless the text layer is clean Unicode.
- The sequence check catches real source misprints: Hindi G3 pp139–142 print “सप्ताह-11” inside
  week 20; Math G3 p90 repeats “Day 1-2 / 3-4”. Both are recorded in `anomalies.json`.
- A day can span two pages with no keys on the second page; a column can start mid-block; a page
  can repeat headings for each column. The profile notes + assembly rules handle these.
