# Page transcription instructions (shared by every state)

You transcribe pages of a printed teacher guide into structured JSON. The app shows teachers
exactly what you write, and a lesson placed under the wrong week/day/heading can harm a class.
**Fidelity beats fluency. Never invent, summarise, translate, correct or reorder content.**

The guide's own layout is described in the PROFILE section appended below. Read it first; it
tells you how this guide marks its location keys (week/day, chapter/day range, ...), its headings
and its columns. These instructions are generic; the profile is guide-specific.

## Input
For each page you get two PNG images: `p###-a.png` (top half) and `p###-b.png` (bottom half).
They overlap by ~8% of the page height: a line visible in both halves must be written ONCE.
Read both halves before writing anything.

## Output
Write one file per page, `p###.json`, UTF-8, exactly this shape (omit nothing; use null/[]):

```json
{
  "pdf_page": 25,
  "printed_page": "23",
  "page_kind": "lesson",
  "header": "running header / chapter title text printed at the top, or null",
  "units": [
    {
      "keys": {"week": "2", "day": "2"},
      "keys_evidence": "highlighted tab 'दिवस 2'; band 'सप्ताह-2'",
      "column": 1,
      "continues_from_previous_page": false,
      "intro": ["unit-level lines printed before the first heading (objectives, titles)"],
      "sections": [
        {
          "number": "1", "heading": "मौखिक भाषा विकास एवं लेखन", "minutes": "30",
          "items": [],
          "sections": [
            {"number": "1.1", "heading": "कविता/बालगीत गाना", "minutes": "5",
             "items": [{"type": "bullet", "text": "..."}], "sections": []}
          ]
        }
      ]
    }
  ],
  "shared": [
    {"number": null, "heading": "a boxed section on the page that belongs to no single unit", "minutes": null,
     "items": [], "sections": []}
  ],
  "uncertain": ["short notes on anything you could not read with certainty"],
  "notes": "anything unusual about the page layout, or null"
}
```

- `page_kind`: one of `lesson` (contains teaching units per the profile), `unit_opener`
  (chapter/unit start page), `plan` (schedule/academic-plan table), `assessment`, `front_matter`,
  `back_matter`, `blank`, `other`. Follow the profile's definitions.
- `units`: one entry per teaching unit printed on the page, in reading order (columns left to
  right). The profile says what a unit is and which `keys` it has. Copy key values **exactly as
  printed** (e.g. day range "1-2"), digits as Western digits. If a key is not printed for a unit,
  use null and explain in `keys_evidence` — never guess it from neighbouring pages.
- `continues_from_previous_page`: true when the unit's first content on this page is the
  continuation of a heading or item started on the previous page (no new heading above it).
- `sections`: nested by the printed hierarchy. `number` is the printed number ("2", "2.1") or null;
  `minutes` is the printed duration text without the word for minutes ("5-7"), or null.
  A heading printed across all columns (spanning units) is repeated inside every unit it spans,
  each with that unit's own items.
- `items`: in reading order. `type` is `bullet` (any bullet/arrow/dash/number list item),
  `text` (plain paragraph), `table` (give `rows`: array of arrays of cell strings) or `figure`
  (picture/diagram/QR; give `desc`: one short neutral description, and any printed caption/labels
  as `text`). A bullet that wraps over several printed lines is ONE item; join the lines with a
  single space and remove hyphenation only when a word was split by the line break.
- `shared`: boxed content not belonging to one unit (e.g. multigrade plans, tips spanning the
  page). Keep its own internal structure the same way.

## Text rules
1. Copy every word exactly, in the printed script and spelling (including misprints). Keep
   nukta, chandrabindu/anusvara, halant, visarga, quotes ‘ ’ “ ”, dashes, `/`, brackets and the
   danda `।` as printed. Keep English words in English. Write digits as printed digits.
   Do NOT modernise or standardise spelling: if the page prints पेन्सिल write पेन्सिल (not
   पेंसिल); if it prints दोहरायें write दोहरायें (not दोहराएँ); half-letter vs anusvara, ए vs ये,
   ँ vs ं exactly as printed. When unsure which form is printed, look again at that word.
2. Do not add words such as "Step", "Day", "Minutes" that are not printed. Icons are not text.
3. If a word or number is unclear, write your best reading and add a note to `uncertain`
   (page-level) naming the section and the word. Do not skip content because it is hard.
4. Text inside pictures (speech bubbles, labelled diagrams) goes into a `figure` item's `text`.
5. Ignore page furniture: crop marks, decorative borders, repeated footer like
   "कक्षा 2 | शिक्षक संदर्शिका (2026-27)" (but do record the printed page number).
6. Pages that are not `lesson` pages: still fill `header`, `printed_page`, `page_kind`; put their
   visible headings/text in `shared` only if the profile asks for it; otherwise leave `units` and
   `shared` empty.

## Self-check before writing each file
- Every printed heading of the page appears exactly once per unit it belongs to, in order.
- Section numbers you wrote are exactly the printed ones (no renumbering).
- The keys are copied from this page's own print, with the evidence stated.
- The JSON is valid (no trailing commas; escape `"` inside strings).
