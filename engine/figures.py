"""Crop the located instructional pictures and place each one in its lesson section.

  python engine/figures.py haryana [--guide ID] [--sources DIR]
  reads   states/<state>/work/figures/<doc>/p###.json   (from the picture-locating job sheets)
  writes  build/<state>/site/figs/<doc>/p###-N.webp     (crops, rendered from the PDF)
  updates states/<state>/work/packs/<guide>.json         (figure items with "crop", report in pack["figures"])

Placement rule (generic): a picture goes to the lesson on its page whose unit keys match the
picture's `unit`; inside it, to the section whose printed number (or heading) matches `section`;
inside that section, right after the item whose text starts like `after_text`. When the
transcription already holds a text-only figure item there, the crop is attached to it. Pictures on
chapter-opener pages go to the chapter intro. Anything that cannot be placed is listed as
unplaced (verify.py warns) instead of being put somewhere wrong.
"""
import argparse
import difflib
import re

import fitz
from PIL import Image, ImageStat

from common import build, document, load_state, read_json, read_page, source_path, work, write_json

PAD = 0.012          # fraction of page added around each box
CROP_WIDTH = 900     # px


def norm(s):
    return re.sub(r'[\s‌‍]+', '', s or '')


def walk(sections):
    for s in sections:
        yield s
        yield from walk(s.get('sections', []))


def find_section(sections, key):
    if not key:
        return None
    k = norm(key).rstrip('.')
    for s in walk(sections):
        if s.get('number') and norm(s['number']).rstrip('.') == k:
            return s
    for s in walk(sections):
        if s.get('heading') and (k in norm(s['heading']) or norm(s['heading']) in k):
            return s
    return None


def best_anchor(subtree, after_text):
    """The item whose text best matches the line printed just before the picture (start or end)."""
    if not after_text:
        return None
    a = norm(after_text)
    best, where = 0.0, None
    for s in subtree:
        for i, it in enumerate(s.get('items', [])):
            t = norm(it.get('text', ''))
            if not t:
                continue
            for part in (t[:len(a)], t[-len(a):]):
                r = difflib.SequenceMatcher(None, a, part, autojunk=False).ratio()
                if r > best:
                    best, where = r, (s, i)
    return where if best >= 0.6 else None


def insert(section, fig, after_text):
    """Search the section and all its sub-steps: the exact spot is usually inside a sub-step."""
    subtree = list(walk([section]))
    hit = best_anchor(subtree, after_text)
    if hit:
        s, i = hit
        items = s['items']
        for j in (i + 1, i + 2):   # transcriber's text-only note for this picture right after the line
            if j < len(items) and items[j].get('type') == 'figure' and not items[j].get('crop'):
                items[j]['crop'] = fig['crop']; items[j].setdefault('desc', fig.get('desc'))
                return 'merged'
        items.insert(i + 1, {'type': 'figure', 'desc': fig.get('desc'), 'crop': fig['crop']})
        return 'inserted'
    for s in subtree:
        for it in s.get('items', []):
            if it.get('type') == 'figure' and not it.get('crop'):
                it['crop'] = fig['crop']; it.setdefault('desc', fig.get('desc'))
                return 'merged'
    section.setdefault('items', []).append({'type': 'figure', 'desc': fig.get('desc'), 'crop': fig['crop']})
    return 'inserted'


def keys_match(lesson_keys, unit, group_key):
    if not unit:
        return False
    for k, v in unit.items():
        if k == group_key or v is None:
            continue
        if norm(str(lesson_keys.get(k))) != norm(str(v)):
            return False
    return True


def crop(doc, page_no, bbox, out):
    if out.exists():
        return True
    page = doc[page_no - 1]
    r = page.rect
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
    x1, y1 = min(1, x1 + PAD), min(1, y1 + PAD)
    if x1 - x0 < 0.03 or y1 - y0 < 0.02:
        return False
    clip = fitz.Rect(r.width * x0, r.height * y0, r.width * x1, r.height * y1)
    z = CROP_WIDTH / max(clip.width, 1)
    z = min(z, 4)
    pix = page.get_pixmap(matrix=fitz.Matrix(z, z), clip=clip)
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    if max(ImageStat.Stat(im.convert('L')).stddev) < 6:     # blank area: the box missed the picture
        return False
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, 'WEBP', quality=70, method=5)
    return True


def place(cfg, g, pack, src):
    group_key = g['profileData']['hierarchy']['group_by']
    report = {'placed': 0, 'merged': 0, 'opener': 0, 'unplaced': [], 'blank': []}
    by_page = {}
    for l in pack['lessons']:
        for p in l['pages']:
            by_page.setdefault((l.get('doc', g['doc']), p), []).append(l)
    openers = {(grp.get('doc', g['doc']), grp['opener_page']): grp for grp in pack['groups'] if grp.get('opener_page')}
    for part in g['parts']:
        doc_id = part['doc']
        fdir = work(cfg['id'], 'figures', doc_id, 'x').parent
        pdf = None
        for f in sorted(fdir.glob('p*.json')):
            data = read_page(f)
            if not data:
                continue
            p = int(f.stem[1:])
            for n, fig in enumerate(data.get('figures', []), start=1):
                bbox = fig.get('bbox')
                if not (isinstance(bbox, list) and len(bbox) == 4):
                    continue
                rel = f'figs/{doc_id}/p{p:03d}-{n}.webp'
                out = build(cfg['id'], 'site', *rel.split('/'))
                if pdf is None:
                    pdf = fitz.open(source_path(document(cfg, doc_id), src))
                if not crop(pdf, p, bbox, out):
                    report['blank'].append({'doc': doc_id, 'page': p, 'n': n, 'desc': fig.get('desc')})
                    continue
                fig = dict(fig, crop=rel)
                if (doc_id, p) in openers:
                    intro = openers[(doc_id, p)].setdefault('intro', [])
                    note = next((it for sec in walk(intro) for it in sec.get('items', [])
                                 if it.get('type') == 'figure' and not it.get('crop')), None)
                    if note:   # the transcriber's text-only note for this picture: attach, don't duplicate
                        note['crop'] = rel
                    else:
                        intro.append({'number': None, 'heading': None, 'minutes': None, 'sections': [],
                                      'items': [{'type': 'figure', 'desc': fig.get('desc'), 'crop': rel}]})
                    report['opener'] += 1
                    continue
                cands = by_page.get((doc_id, p), [])
                target = [l for l in cands if keys_match(l['keys'], fig.get('unit'), group_key)]
                if not target and len(cands) == 1:
                    target = cands
                if len(target) != 1:
                    report['unplaced'].append({'doc': doc_id, 'page': p, 'n': n, 'desc': fig.get('desc'), 'unit': fig.get('unit')})
                    continue
                les = target[0]
                sec = find_section(les['sections'] + les.get('shared', []), fig.get('section'))
                if sec is None or not best_anchor(list(walk([sec])), fig.get('after_text')):
                    # section label not found, or the line it follows is elsewhere: search the whole lesson
                    whole = {'number': None, 'heading': None, 'items': [], 'sections': les['sections']}
                    if best_anchor(list(walk([whole])), fig.get('after_text')) or any(
                            it.get('type') == 'figure' and not it.get('crop') for x in walk(les['sections']) for it in x.get('items', [])):
                        sec = whole
                    elif sec is None:
                        sec = les['sections'][0] if les['sections'] else None
                if sec is None:
                    report['unplaced'].append({'doc': doc_id, 'page': p, 'n': n, 'desc': fig.get('desc'), 'unit': fig.get('unit')})
                    continue
                how = insert(sec, fig, fig.get('after_text'))
                report['merged' if how == 'merged' else 'placed'] += 1
    pack['figures'] = report
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide')
    ap.add_argument('--sources')
    a = ap.parse_args()
    cfg = load_state(a.state)
    for g in cfg['guides']:
        if a.guide and g['id'] != a.guide:
            continue
        path = work(a.state, 'packs', f"{g['id']}.json")
        pack = read_json(path)
        if not pack:
            continue
        r = place(cfg, g, pack, a.sources)
        write_json(path, pack)
        print(f"{g['id']}: placed {r['placed']}, attached to existing {r['merged']}, chapter openers {r['opener']}, "
              f"unplaced {len(r['unplaced'])}, empty boxes {len(r['blank'])}")


if __name__ == '__main__':
    main()
