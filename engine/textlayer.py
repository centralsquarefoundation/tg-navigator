"""Extract the PDF's own text layer (where one exists) as positioned lines, decoding legacy
Hindi fonts. Used as an independent second reading to check the vision transcription.

  python engine/textlayer.py haryana [--doc ID] [--sources DIR]
  -> build/<state>/textlayer/<doc>.json : {page: [{x,y,x1,y1,size,color,font,text}]}

Pages drawn as vector outlines or images have no text layer; they simply get no lines.
Nothing here is guide-specific: fonts are recognised by name (engine/fonts/).
"""
import argparse
import importlib.util
import pathlib
import re

import fitz

from common import build, load_state, source_path, write_json

_spec = importlib.util.spec_from_file_location('hindi_text', pathlib.Path(__file__).with_name('fonts') / 'hindi_text.py')
hindi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hindi)

DEVA = re.compile('[ऀ-ॿ]')
PRIVATE = re.compile('[\ue000-\uf8ff]')   # icon-font glyphs (bullets, arrows): not text


def drawn_once(chars):
    """Bold is sometimes printed by drawing a run twice; keep one copy."""
    letters = [c for c, _, _ in chars if c != ' ']
    n = len(letters)
    if n > 3 and n % 2 == 0 and letters[:n // 2] == letters[n // 2:]:
        seen = 0
        for i, (c, _, _) in enumerate(chars):
            seen += c != ' '
            if seen == n // 2:
                return chars[:i + 1]
    return chars


def page_lines(page):
    out = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            parts, fonts, sizes, colors = [], set(), [], []
            for s in l['spans']:
                chars = drawn_once([(c['c'], c['origin'][0], c['bbox'][2] - c['bbox'][0]) for c in s['chars']])
                legacy = hindi.family(s['font'])
                raw = hindi.ordered_text(chars) if legacy else ''.join(c for c, _, _ in chars)
                parts.append(hindi.decode(raw, s['font']))
                fonts.add(s['font'].split('+')[-1]); sizes.append(s['size']); colors.append(s['color'])
            text = re.sub(r'\s+', ' ', PRIVATE.sub('', ''.join(parts))).strip()
            if not text:
                continue
            x0, y0, x1, y1 = l['bbox']
            out.append({'x': round(x0, 1), 'y': round(y0, 1), 'x1': round(x1, 1), 'y1': round(y1, 1),
                        'size': round(max(sizes), 1), 'color': f'#{max(colors):06x}', 'font': sorted(fonts), 'text': text})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--doc')
    ap.add_argument('--sources')
    a = ap.parse_args()
    cfg = load_state(a.state)
    for g in cfg['documents']:
        if a.doc and g['id'] != a.doc:
            continue
        doc = fitz.open(source_path(g, a.sources))
        pages, with_text = {}, 0
        for i, p in enumerate(doc, start=1):
            lines = page_lines(p)
            if lines:
                pages[str(i)] = lines; with_text += 1
        write_json(build(a.state, 'textlayer', f"{g['id']}.json"), pages, compact=True)
        print(f"{g['id']}: text layer on {with_text}/{doc.page_count} pages")


if __name__ == '__main__':
    main()
