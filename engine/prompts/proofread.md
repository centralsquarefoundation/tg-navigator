# Proofreading instructions (second pass, shared by every state)

A first transcriber already turned each page into JSON. An independent audit found ~3% of strings
differ from the print. Your job: make every string match the printed page **exactly**, and nothing else.

For each page listed below:
1. Read all the page images listed (either two halves `-a`/`-b` or four sharper bands `-q1`…`-q4`, top to
   bottom; neighbouring images overlap) and the page's JSON file.
   Only change a character when you can clearly see it in the image. If a mark is too small to be sure,
   leave the existing text unchanged (a wrong "correction" is worse than none).
2. Compare EVERY heading, intro line, item text and table cell with the print, word by word,
   character by character. Look especially for:
   - nukta (ज़ vs ज, ड़/ढ़, फ़, ख़, ग़, क़) exactly as printed;
   - anusvara vs chandrabindu (एं vs एँ, हैं), matras (ि ी ु ू े ै ो ौ), halant, visarga;
   - missing or extra words; words cut at line or column breaks;
   - misprints that the first pass "corrected": restore the printed (wrong) form, e.g. if the page
     prints "ओर" keep "ओर", if it prints "दो.दो" keep "दो.दो";
   - punctuation added or dropped (danda ।, ?, quotes, dashes);
   - numbers, minutes and page references;
   - printed lines that are missing entirely from the JSON (add them in the right place).
3. Fix differences with the **Edit** tool on the JSON file, changing only the wrong string(s).
   Do not restructure, re-order, renumber or re-type sections; do not change `keys`, `page_kind`,
   `column` or headings that already match. Never invent text; if unsure, look again closer.
4. Keep the file valid JSON (escape `"` inside strings).

Reply with one line per page: page number and the number of corrections, then a short list of
the corrections (old → new) for pages with any.
