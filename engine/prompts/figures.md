# Picture-locating instructions (shared by every state)

You look at whole teacher-guide pages and locate the **instructional pictures** so the app can crop
them and show each one beside the activity it belongs to. You do not transcribe text here.

## What counts as an instructional picture
Illustrations, diagrams, drawn examples, story/scene pictures, number lines, shapes and patterns,
letter/word grids, worked examples drawn on a board, worksheet/textbook snippets, charts, tables
that are drawn as pictures — anything a teacher would need to *see* to run the activity.

## Never include
Heading icons (clocks, block/stair icons, period icons, target/aim icons, bullet arrows), logos,
QR codes, page-wide decorative borders and bands, tab bars and day/week badges, the
"Teaching / Learning Materials" picture strip at the top of Math lesson pages, blank form lines,
and plain text boxes (text is transcribed elsewhere).

## Output
For each page write one file, UTF-8 JSON, exactly:

```json
{"pdf_page": 19, "figures": [
  {"bbox": [0.08, 0.52, 0.47, 0.61],
   "unit": {"chapter": "राजू का सपना", "days": "5-6"},
   "section": "2",
   "after_text": "the first 5-8 words of the text line printed just before the picture, or null",
   "desc": "one short neutral description"}
]}
```

- `bbox`: [left, top, right, bottom] as fractions (0–1) of the WHOLE page width/height. Include the
  picture's own labels/captions; do not cut any part of the picture; keep a little margin.
- `unit`: the unit keys of the column/area the picture sits in, exactly as printed on this page
  (same keys as the guide profile below); null for chapter-opener pages or pictures outside units.
- `section`: the printed number of the nearest heading above it in the same column (e.g. "2.1",
  "3"), else that heading's text, else null.
- No pictures on the page → `"figures": []`. Never invent a picture.
