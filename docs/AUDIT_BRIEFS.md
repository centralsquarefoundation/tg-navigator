# Blind audit briefs

Two independent audits run in fresh contexts (no knowledge of how the build went). Reusable for
every state: replace `haryana` and the paths.

## Audit A — app structure, functionality and worth (may fix app code)

You are auditing a mobile web app for government-school teachers in Haryana (Hindi-first, often
new to smartphones). It turns printed Teacher Guides into day-by-day lesson plans.

- Code: `C:\GitHub\mobile-tg-maker\app\` (shared app), built site in `build\haryana\site\`
  (served at http://localhost:8765 — start it with `python -m http.server 8765 --directory build/haryana/site`
  if it is not running). Engine: `engine\`, config: `states\haryana\`.
- Read README.md and AGENTS.md first. Rules: no state-specific code in app/ or engine/;
  teacher data stays on the device; fidelity to the source guides.
- Use the browser at 360–390 px width (and once at desktop width). Exercise every route:
  आज (today), पूरा साल (year), सभी पाठ (search), a lesson, original-page viewer, मूल संदर्शिका, मदद,
  class/subject pickers for every combination, mark taught / undo, notes, मेरी सूची, offline button,
  text-size buttons, back/forward navigation, deep links to a lesson, reload.
- Judge: does it work; is it understandable for a Hindi-first teacher; accessibility (contrast,
  touch sizes ≥ 44px, focus, alt text, no horizontal scroll); performance (data sizes, first load);
  offline behaviour; anything misleading or broken; is it worth using compared with the PDF.
- Fix clear bugs in `app/` (and `engine/publish.py` only if the bug is in the published data shape).
  After a fix run `python engine/publish.py haryana` and recheck in the browser. Do not change
  lesson content or transcriptions. Do not deploy anything.
- Report: findings ranked by severity, what you fixed (files, why), what you left and why.

## Audit B — content against the Teacher Guides (report only)

You are checking that a lesson app shows exactly what the printed Teacher Guides say, in the right
place. Source PDFs: `C:\Users\LENOVO\Downloads\` (file names in `states\haryana\state.json`).
Rendered pages: `build\haryana\site\pages\<doc>\p###.webp` (PDF page numbers). App data:
`build\haryana\site\data\<guide>.json` (lessons, sections, items, `pages`, `doc`, figure `crop`s
under `build\haryana\site\`).

1. **Links** (all lessons, scripted): every lesson's `pages` and every `crop` file exists; every
   guide section page range is inside the PDF; report any broken link.
2. **Placement** (sample): pick at random at least 4 lessons per guide (plus every lesson that has
   a `notice`), open its page image(s), and confirm the week/day or chapter/day shown is what the
   page prints, and that each section heading and its content sit where the page puts them
   (no content from another day/column/section).
3. **Text** (same sample): compare every heading and item word by word with the page. Count
   differences by kind: wrong word, missing text, extra text, spelling/matra difference, number or
   minutes difference. Quote each with lesson id, section and page.
4. **Pictures** (sample + all crops of 2 lessons per guide): is each crop the whole intended
   picture (not cut, not a different picture, not an icon), and is it placed under the activity
   that uses it? Note pictures on the page that the lesson is missing.
5. **Coverage**: are there day pages in the PDFs with no lesson in the app, or lessons whose pages
   are not day pages?

Do not edit any file. Report: a summary table per guide (sampled lessons, placement errors, text
errors by kind, picture problems, broken links), then every problem with evidence, then an
estimated error rate with the sample size, then the 5 most important fixes.
