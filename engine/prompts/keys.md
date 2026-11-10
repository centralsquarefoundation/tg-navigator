# Location re-read (independent check, shared by every state)

You re-read ONLY where each page says it belongs. Another pass already transcribed the pages; you
must not look at its output. Your answer is compared with it, so read carefully and independently.

For each page listed, Read the page image and Write one JSON file:

```json
{"pdf_page": 25, "printed_page": "23", "page_kind": "lesson",
 "units": [{"column": 1, "keys": {"week": "2", "day": "2"}, "evidence": "highlighted tab 'दिवस 2', band 'सप्ताह-2'"}]}
```

- `printed_page`: the page number printed on the page (usually at the bottom), exactly as printed; null if none.
- `page_kind`: `lesson` if the page holds teaching units (as described in the profile below); otherwise
  `unit_opener`, `plan`, `front_matter`, `back_matter` or `other`, and `units: []`.
- `units`: one entry per unit, left to right; `keys` exactly as printed (the profile says which marks
  hold them). If a key is not printed on this page, use null — never infer it from other pages.
- Be especially careful with highlighted tabs: say which tab is visually emphasised (stronger fill, dark text).
