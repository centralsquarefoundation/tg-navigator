"""Attach "what to prepare" lists to lessons, keeping only items copied from the lesson's own text.

  python engine/materials.py haryana [--guide ID]
  reads   states/<state>/work/materials/<guide>/*.json   (from `jobs.py --kind materials` sheets)
  updates states/<state>/work/packs/<guide>.json          (lesson["prep"], report in pack["materials"])

An item is kept only when its `quote` occurs in the lesson text and its `name` occurs inside the
quote (spaces, joiners and quote-mark styles ignored), so nothing paraphrased or invented reaches
teachers. Each kept item records the section it was found in, so the app can link to that step.
"""
import argparse
import re

from common import load_state, read_json, read_page, work, write_json

QUOTES = str.maketrans({c: "'" for c in '‘’‚‛“”„"`´'})


def norm(s):
    return re.sub(r'[\s‌‍​]+', '', str(s or '').translate(QUOTES))


def blocks(les):
    """(top-level section label, normalised text) for every place in the lesson."""
    out = []
    def text(s):
        parts = [s.get('number') or '', s.get('heading') or '']
        for it in s.get('items', []):
            parts.append(it.get('text') or '')
            for r in it.get('rows') or []:
                parts.extend(str(c) for c in r)
        for c in s.get('sections', []):
            parts.append(text(c))
        return ' '.join(parts)
    for s in les['sections'] + les.get('shared', []):
        label = ' '.join(x for x in (s.get('number'), s.get('heading')) if x)
        out.append((label, norm(text(s))))
    if les.get('intro'):
        out.append(('', norm(' '.join(les['intro']))))
    return out


def attach(cfg, g, pack):
    found = {}
    for f in sorted(work(cfg['id'], 'materials', g['id'], 'x').parent.glob('*.json')):
        found.update(read_page(f) or {})
    report = {'lessons_with_list': 0, 'kept': 0, 'dropped': [], 'missing_lessons': []}
    for les in pack['lessons']:
        items = found.get(les['id'])
        if items is None:
            report['missing_lessons'].append(les['id'])
            continue
        places = blocks(les)
        prep, seen = [], set()
        for it in items if isinstance(items, list) else []:
            name, quote = it.get('name'), it.get('quote')
            # a quote may join consecutive printed lines ("…\n- …"): each line must be in the same place
            pieces = [norm(re.sub(r'^\s*(?:[-#]+\s*)', '', p)) for p in str(quote or '').split('\n')]
            pieces = [p for p in pieces if p]
            n, q = norm(name), ''.join(pieces)
            where = next((label for label, t in places if pieces and all(p in t for p in pieces)), None)
            if not n or n not in q or where is None:
                report['dropped'].append({'lesson': les['id'], 'name': name,
                                          'why': 'name not in quote' if n not in q else 'quote not in lesson text'})
                continue
            if n in seen:
                continue
            seen.add(n)
            prep.append({'kind': 'book' if it.get('kind') == 'book' else 'material', 'name': name.strip(), 'where': where})
        les['prep'] = prep
        report['kept'] += len(prep)
        report['lessons_with_list'] += bool(prep)
    pack['materials'] = report
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide')
    a = ap.parse_args()
    cfg = load_state(a.state)
    for g in cfg['guides']:
        if a.guide and g['id'] != a.guide:
            continue
        path = work(a.state, 'packs', f"{g['id']}.json")
        pack = read_json(path)
        if not pack:
            continue
        r = attach(cfg, g, pack)
        write_json(path, pack)
        print(f"{g['id']}: {r['kept']} items on {r['lessons_with_list']} lessons, dropped {len(r['dropped'])}, "
              f"lessons not yet processed {len(r['missing_lessons'])}")


if __name__ == '__main__':
    main()
