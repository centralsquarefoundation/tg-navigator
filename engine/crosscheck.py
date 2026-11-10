"""Independent placement checks: every lesson's keys are compared with signals that did not come
from the transcription that produced it. Called by verify.py; nothing here is state-specific —
the patterns live in the guide profile under checks.key_echo and checks.textlayer_keys.

1. reread    — a separate vision pass that read only the location marks (states/<s>/work/keys/<doc>/)
2. textlayer — the PDF's own text: e.g. 'सप्ताह-(\\d+)', and for tab rows the one tab printed in a
               different colour from its siblings (the highlighted day)
3. echo      — numbers inside the lesson text that repeat its keys (worksheet 13.3 on week 13 day 3)
4. pages     — printed page numbers must follow the PDF page numbers with one steady offset

Each returns issues + an agreement summary. A disagreement is an error unless the page is an
acknowledged source anomaly (anomalies.json) — then it is a warning with the evidence attached.
"""
import collections
import difflib
import re

from common import build, read_json, read_page, work


def _norm(s):
    return re.sub(r'[\s‌‍]+', '', str(s or ''))


def _same(a, b, fuzzy):
    a, b = _norm(a), _norm(b)
    if a == b:
        return True
    if fuzzy and a and b and not a.isdigit() and not b.isdigit():
        return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8
    return False


def reread(cfg, g, pack, add):
    keys = g['profileData']['hierarchy']['keys']
    group_key = g['profileData']['hierarchy']['group_by']
    agree = disagree = missing = 0
    for les in pack['lessons']:
        doc = les.get('doc', g['doc'])
        printed = les.get('printed_keys')       # evidence-backed corrections compare the printed value
        for p in les['pages']:
            r = read_page(work(cfg['id'], 'keys', doc, f'p{p:03d}.json'))
            if r is None:
                missing += 1
                continue
            units = [u for u in r.get('units', []) if any(v is not None for v in (u.get('keys') or {}).values())]
            if not units:
                continue          # continuation page with no printed keys
            want = printed or les['keys']
            ok = any(all(_same(u['keys'].get(k), want.get(k), k == group_key) for k in keys
                         if u['keys'].get(k) is not None) for u in units)
            if ok:
                agree += 1
            else:
                disagree += 1
                seen = '; '.join(', '.join(f'{k}={u["keys"].get(k)}' for k in keys) for u in units)
                add('error', 'keys-reread', f'an independent re-read of page {p} found [{seen}], the lesson says '
                    f'{", ".join(f"{k}={want.get(k)}" for k in keys)}', les['id'], p, doc)
    return {'agree': agree, 'disagree': disagree, 'not_reread': missing}


def textlayer(cfg, g, pack, add):
    spec = g['profileData'].get('checks', {}).get('textlayer_keys')
    if not spec:
        return None
    layers = {d: read_json(build(cfg['id'], 'textlayer', f'{d}.json'), {}) for d in {l.get('doc', g['doc']) for l in pack['lessons']}}
    agree = disagree = undecided = 0
    for les in pack['lessons']:
        doc = les.get('doc', g['doc'])
        want = les.get('printed_keys') or les['keys']
        lines = layers.get(doc, {}).get(str(les['pages'][0]), [])
        if not lines:
            continue
        for key, rule in spec.items():
            hits = []
            for l in lines:
                if 'max_y' in rule and l['y'] > rule['max_y']:
                    continue          # only the region where the guide prints its location marks
                for m in re.finditer(rule['pattern'], l['text']):
                    hits.append((m.group(1), l['color']))
            value = None
            if rule.get('pick') == 'odd-color' and hits:
                colors = collections.Counter(c for _, c in hits)
                odd = [v for v, c in hits if colors[c] == 1 and len(colors) > 1]
                value = odd[0] if len(odd) == 1 else None
            elif hits:
                vals = {v for v, _ in hits}
                value = vals.pop() if len(vals) == 1 else None
            if value is None:
                undecided += 1
                continue
            if _same(value, want.get(key), False):
                agree += 1
            else:
                disagree += 1
                add('error', 'keys-textlayer', f"the PDF's own text on page {les['pages'][0]} gives {key}={value}, "
                    f"the lesson says {want.get(key)}", les['id'], les['pages'][0], doc)
    return {'agree': agree, 'disagree': disagree, 'undecided': undecided}


def echo(cfg, g, pack, add):
    rules = g['profileData'].get('checks', {}).get('key_echo') or []
    if not rules:
        return None
    agree = disagree = printed = 0
    layers = {}
    def in_pdf_text(les, found):
        # the same number in the PDF's own text on that page = printed so in the source, not a misreading
        doc = les.get('doc', g['doc'])
        if doc not in layers:
            layers[doc] = read_json(build(cfg['id'], 'textlayer', f'{doc}.json'), {})
        page_text = _norm(' '.join(l['text'] for p in les['pages'] for l in layers[doc].get(str(p), [])))
        return bool(page_text) and _norm(found) in page_text
    def texts(ss):
        for s in ss:
            yield s.get('heading') or ''
            for it in s.get('items', []):
                yield it.get('text') or ''
            yield from texts(s.get('sections', []))
    for les in pack['lessons']:
        body = ' '.join(texts(les['sections'] + les.get('shared', [])))
        for rule in rules:
            for m in re.finditer(rule['pattern'], body):
                got = {k: str(int(m.group(i))) for k, i in rule['groups'].items()}
                want = {k: str(int(les['keys'][k])) if str(les['keys'].get(k) or '').isdigit() else None for k in got}
                if all(got[k] == want[k] for k in got):
                    agree += 1
                else:
                    disagree += 1
                    if in_pdf_text(les, m.group(0)):
                        printed += 1
                        add('note', 'keys-echo', f"text «{m.group(0)}» points to {', '.join(f'{k} {v}' for k, v in got.items())} "
                            f"while the lesson is {', '.join(f'{k} {v}' for k, v in want.items())}; the PDF's own text on this page "
                            f"prints the same, so it is the source's reference (often to an earlier sheet), kept as printed",
                            les['id'], les['pages'][0], les.get('doc', g['doc']))
                        continue
                    add('warn', 'keys-echo', f"text «{m.group(0)}» points to {', '.join(f'{k} {v}' for k, v in got.items())}; "
                        f"the lesson is {', '.join(f'{k} {v}' for k, v in want.items())} (often a source misprint — compare with the page)",
                        les['id'], les['pages'][0], les.get('doc', g['doc']))
    return {'agree': agree, 'disagree': disagree, 'of_which_printed_so_in_pdf_text': printed}


def pages(cfg, g, pack, add):
    by_doc = collections.defaultdict(list)
    for les in pack['lessons']:
        for p, pr in zip(les['pages'], les['printed_pages']):
            if str(pr or '').isdigit():
                by_doc[les.get('doc', g['doc'])].append((les['id'], p, int(pr)))
    out = {}
    for doc, rows in by_doc.items():
        # The offset may change where the printed numbering itself jumps (a source feature); flag only
        # a page whose offset differs from both neighbours (a misread number or a page out of order).
        rows = sorted(set(rows), key=lambda r: r[1])
        offs = [p - pr for _, p, pr in rows]
        bad = [rows[i] for i in range(len(rows)) if 0 < i < len(rows) - 1
               and offs[i] != offs[i - 1] and offs[i] != offs[i + 1]]
        for lid, p, pr in bad:
            add('warn', 'printed-page', f'page {p} reads as printed page {pr}, out of step with the pages around it '
                f'(misread page number, or a page out of order)', lid, p, doc)
        jumps = [(rows[i][1], offs[i - 1], offs[i]) for i in range(1, len(rows)) if offs[i] != offs[i - 1] and rows[i] not in bad and rows[i - 1] not in bad]
        out[doc] = {'agree': len(rows) - len(bad), 'disagree': len(bad), 'numbering_jumps': jumps}
    return out


def run(cfg, g, pack, add):
    return {'reread': reread(cfg, g, pack, add), 'textlayer': textlayer(cfg, g, pack, add),
            'echo': echo(cfg, g, pack, add), 'pages': pages(cfg, g, pack, add)}
