"""Second reading: compare the vision transcription with the PDF's own text layer.

  python engine/reconcile.py haryana [--guide ID]
  (reads build/<state>/textlayer/<doc>.json and states/<state>/work/packs/<guide>.json, updates the pack)

For every transcribed string (heading, intro line, item) on pages that have a text layer:
  * find the text-layer lines that make up the same text (order-independent, so multi-column
    pages and odd PDF reading orders do not matter);
  * exact match            -> status 'exact';
  * same words, spelling differs -> status 'close'; the PDF's reading is stored beside the text
    for review. Only when the profile sets "textlayer_policy": "prefer" is the text layer's
    spelling taken (use that only for clean Unicode text layers: decoded legacy fonts were shown
    to be LESS accurate than vision on Haryana 2026 Hindi G2, e.g. लेखन -> लेऽन);
  * substantially different -> keep the vision text, status 'mismatch' (flagged for review).
Pages without a text layer get status 'single-reading'. The text layer itself can be wrong (legacy
font decoding), so every correction is also listed in the pack's `reconcile.corrections` and the
review report shows the most frequent ones.
"""
import argparse
import difflib
import re
import unicodedata
from collections import Counter

from common import build, load_state, read_json, work, write_json

SPACE = re.compile(r'[\s‌‍]+')
PUNCT = re.compile(r'[\ue000-\uf8ff\s‌‍•>‣▪◦·\-–—―‐‘’“”"\'`.,;:!?।॥()\[\]{}/|*]+')


def nfc(s):
    return unicodedata.normalize('NFC', s or '')


def skel(s):
    """Matching skeleton: no spaces or punctuation."""
    return PUNCT.sub('', nfc(s))


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


class PageText:
    def __init__(self, lines):
        self.lines = [nfc(l['text']) for l in lines]
        self.skels = [skel(t) for t in self.lines]

    def cover(self, v):
        """Text-layer reading of string v: the lines whose text appears inside v, in v's order."""
        vs = skel(v)
        if len(vs) < 3:
            return None, 0.0
        cands = []
        for i, ls in enumerate(self.skels):
            if not ls:
                continue
            m = difflib.SequenceMatcher(None, vs, ls, autojunk=False)
            blocks = [b for b in m.get_matching_blocks() if b.size >= 2]
            got = sum(b.size for b in blocks)
            if not blocks or got < 0.8 * len(ls) or got < 3:
                continue
            start, end = blocks[0].a, blocks[-1].a + blocks[-1].size
            if end - start > 1.3 * len(ls) + 4:
                continue
            cands.append((start, end, got / len(ls), i))
        chosen = []
        for c in sorted(cands, key=lambda c: (-(c[2] * len(self.skels[c[3]])), -c[2])):   # longest well-matched lines first
            if all(c[1] <= o[0] or c[0] >= o[1] for o in chosen):
                chosen.append(c)
        if not chosen:
            return None, 0.0
        chosen.sort()
        text = ' '.join(self.lines[c[3]] for c in chosen)
        return text, ratio(vs, skel(text))


def correct(v, t):
    """Word-level merge: take the text layer's spelling where words correspond."""
    vw = nfc(v).split()
    tw = [w for w in nfc(t).split() if skel(w) or w not in '•▪◦‣>·-–']   # list markers are not words
    out, changes = [], []
    for op, a0, a1, b0, b1 in difflib.SequenceMatcher(None, [skel(w) for w in vw], [skel(w) for w in tw], autojunk=False).get_opcodes():
        if op == 'equal':
            out += vw[a0:a1]
        elif op == 'replace':
            va, ta = ' '.join(vw[a0:a1]), ' '.join(tw[b0:b1])
            if ratio(skel(va), skel(ta)) >= 0.6:
                out += tw[b0:b1]
                changes.append((va, ta))
            else:
                out += vw[a0:a1]
        elif op == 'delete':
            out += vw[a0:a1]          # vision saw words the text layer lacks: keep them
        # 'insert': text-layer words absent from vision -> not added (could belong to a neighbour)
    return ' '.join(out), changes


def walk(sections):
    for s in sections:
        yield s, 'heading'
        for it in s.get('items', []):
            if it.get('text'):
                yield it, 'text'
        yield from walk(s.get('sections', []))


def reconcile_pack(pack, textlayer, prefer=False):
    corrections = Counter()
    totals = Counter()
    for les in pack['lessons'] + [{'id': g['id'], 'pages': [g['opener_page']] if g.get('opener_page') else [],
                                   'sections': g.get('intro', []), 'intro': [], 'shared': []} for g in pack['groups']]:
        pages = [str(p) for p in les['pages'] if str(p) in textlayer]
        stats = Counter()
        if not pages:
            stats['single-reading'] = 1
            les['textcheck'] = dict(stats)
            continue
        pt = PageText([l for p in pages for l in textlayer[p]])
        targets = [(les['intro'], i) for i in range(len(les['intro']))]
        for obj, field in list(walk(les['sections'])) + list(walk(les.get('shared', []))):
            targets.append((obj, field))
        for obj, field in targets:
            v = obj[field] if not isinstance(obj, list) else obj[field]
            if not v or len(skel(v)) < 3:
                continue
            t, r = pt.cover(v)
            stats['checked'] += 1
            if t is not None and skel(t) == skel(v):
                stats['exact'] += 1
                continue
            if t is not None and r >= 0.85:
                fixed, changes = correct(v, t)
                if not prefer:
                    # check-only (default): keep the vision text, record the PDF's reading for review
                    stats['close'] += 1
                    for c in changes:
                        corrections[c] += 1
                    if changes and not isinstance(obj, list):
                        obj.setdefault('textlayer', {})[field] = t
                    continue
                if changes and fixed != v:
                    if isinstance(obj, list):
                        obj[field] = fixed
                    else:
                        obj.setdefault('vision', {})[field] = v
                        obj[field] = fixed
                    for c in changes:
                        corrections[c] += 1
                    stats['corrected'] += 1
                else:
                    stats['close'] += 1
            else:
                stats['mismatch'] += 1
                if not isinstance(obj, list):
                    obj.setdefault('flags', []).append({'field': field, 'textlayer_ratio': round(r, 2), 'textlayer': t})
        les['textcheck'] = dict(stats)
        totals.update(stats)
    pack['reconcile'] = {'totals': dict(totals),
                         'corrections': [{'vision': a, 'textlayer': b, 'count': n} for (a, b), n in corrections.most_common()]}
    return pack


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide')
    a = ap.parse_args()
    cfg = load_state(a.state)
    for g in cfg['guides']:
        if a.guide and g['id'] != a.guide:
            continue
        pack_path = work(a.state, 'packs', f"{g['id']}.json")
        pack = read_json(pack_path)
        if not pack:
            continue
        tl = read_json(build(a.state, 'textlayer', f"{g['doc']}.json"), {})
        reconcile_pack(pack, tl, prefer=g['profileData'].get('textlayer_policy') == 'prefer')
        write_json(pack_path, pack)
        t = pack['reconcile']['totals']
        print(f"{g['id']}: {t}  distinct corrections: {len(pack['reconcile']['corrections'])}")


if __name__ == '__main__':
    main()
