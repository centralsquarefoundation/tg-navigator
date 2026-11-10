"""Automatic checks on an assembled guide pack. Nothing guide-specific: every rule is either
universal (numbering, coverage, duplicates) or switched on by the profile's `checks` block.

  python engine/verify.py haryana [--guide ID]
  -> states/<state>/work/checks/<guide>.json  and a one-line summary per guide

Levels: error = placement/coverage is wrong or unknown (must be fixed before publishing);
        warn  = probably fine but worth a look (source misprint, unusual numbering, text-layer mismatch);
        info  = recorded for the optional human review (transcriber uncertainty notes).
"""
import argparse
import difflib
import json
import re

from common import guide, load_state, parse_pages, read_json, work, write_json


def num(s):
    """'5-7' -> (5, 7); '30' -> (30, 30); else None."""
    m = re.fullmatch(r'\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*', s or '')
    return (int(m.group(1)), int(m.group(2) or m.group(1))) if m else None


def day_range(s):
    m = re.fullmatch(r'\s*(\d+)\s*(?:-\s*(\d+))?\s*', s or '')
    return (int(m.group(1)), int(m.group(2) or m.group(1))) if m else None


def all_text(sections):
    for s in sections:
        yield s.get('heading') or ''
        for it in s.get('items', []):
            yield it.get('text') or ''
            for r in it.get('rows', []) or []:
                yield ' '.join(r)
        yield from all_text(s.get('sections', []))


def verify(cfg, g, pack):
    prof = g['profileData']
    checks = prof.get('checks', {})
    keys = prof['hierarchy']['keys']
    issues = []

    def add(level, code, msg, lesson=None, page=None):
        issues.append({'level': level, 'code': code, 'msg': msg, 'lesson': lesson, 'page': page})

    vdir = work(cfg['id'], 'vision', g['doc'], 'x').parent
    for p in parse_pages(g['pages'].get('lessons', '')) + parse_pages(g['pages'].get('plan', '')):
        f = vdir / f'p{p:03d}.json'
        if not f.exists():
            add('error', 'not-transcribed', 'page not transcribed yet', page=p)
            continue
        try:
            json.loads(f.read_text(encoding='utf-8'))
        except Exception as e:
            add('error', 'bad-json', f'transcription is not valid JSON: {e}', page=p)

    for row in pack['page_index']:
        if row['kind'] == 'lesson' and not row['units']:
            add('error', 'lesson-page-without-units', 'page marked lesson but no unit found', page=row['page'])
        if checks.get('expect_one_unit_per_lesson_page') and row['kind'] == 'lesson' and len({json.dumps(u, sort_keys=True) for u in row['units']}) > 1:
            add('error', 'several-units', f"{len(row['units'])} units on a page that should hold one", page=row['page'])

    seen = {}
    pat = {k: re.compile(v) for k, v in checks.get('key_pattern', {}).items()}
    for les in pack['lessons']:
        k = les['keys']
        for name in keys:
            if k.get(name) in (None, '', 'None'):
                add('error', 'missing-key', f'{name} not printed/read', les['id'], les['pages'][0])
            elif name in pat and not pat[name].match(k[name]):
                add('error', 'bad-key', f'{name}={k[name]!r} does not look like a valid value', les['id'], les['pages'][0])
        sig = (les['group'], tuple(k.get(n) for n in keys))
        if sig in seen:
            add('error', 'duplicate', f'same keys as {seen[sig]}', les['id'], les['pages'][0])
        seen[sig] = les['id']
        if not les['sections'] and not les['intro']:
            add('error', 'empty-lesson', 'lesson has no content', les['id'], les['pages'][0])
        check_numbering(les, add)
        for u in les.get('uncertain', []) or []:
            add('info', 'transcriber-note', str(u), les['id'], les['pages'][0])
        for s, _ in walk_flags(les['sections'] + les.get('shared', [])):
            for f in s.get('flags', []):
                add('warn', 'textlayer-mismatch',
                    f"vision and PDF text differ (similarity {f['textlayer_ratio']}): «{(s.get('text') or s.get('heading') or '')[:90]}»",
                    les['id'], les['pages'][0])

    seq = checks.get('sequence')
    if seq == 'week-day':
        check_week_day(pack, checks.get('days_per_week', 6), add)
    elif seq == 'chapter-days':
        check_chapter_days(pack, add)

    # group titles must appear in the guide's own plan pages (when the guide has any)
    plan_text = ' '.join(t for pl in pack.get('plan', []) for t in all_text(pl['shared']))
    if plan_text and not all(g2['key'].isdigit() for g2 in pack['groups']):
        squash = re.sub(r'\s+', '', plan_text)
        for grp in pack['groups']:
            t = re.sub(r'\s+', '', grp['title'])
            if t and t not in squash:
                best = max((difflib.SequenceMatcher(None, t, squash[i:i + len(t)]).ratio()
                            for i in range(0, max(1, len(squash) - len(t)), 2)), default=0)
                if best < 0.8:
                    add('warn', 'group-not-in-plan', f"«{grp['title']}» not found in the academic plan pages (best match {best:.2f})", page=grp['pages'][0])
    for grp in pack['groups']:
        if seq == 'chapter-days' and not grp.get('opener_page'):
            add('warn', 'group-without-opener', f"«{grp['title']}» has no opener page (a page may be mis-assigned)", page=grp['pages'][0])

    # source anomalies confirmed against the page image (states/<state>/anomalies.json)
    known = (read_json(work(cfg['id'], 'x').parent.parent / 'anomalies.json', {}) or {}).get(g['id'], [])
    for i in issues:
        for a in known:
            if i['page'] == a['page'] and i['code'] in a['codes'] and i['level'] == 'error':
                i['level'] = 'warn'
                i['acknowledged'] = a['evidence']
    counts = {lv: sum(1 for i in issues if i['level'] == lv) for lv in ('error', 'warn', 'info')}
    return {'guide': g['id'], 'counts': counts, 'lessons': len(pack['lessons']), 'groups': len(pack['groups']),
            'textcheck': pack.get('reconcile', {}).get('totals'), 'issues': issues}


def walk_flags(sections):
    for s in sections:
        yield s, 'heading'
        for it in s.get('items', []):
            yield it, 'text'
        yield from walk_flags(s.get('sections', []))


def check_numbering(les, add):
    def level(sections, parent):
        nums = [s.get('number') for s in sections if s.get('number')]
        expect = 1
        for s in sections:
            n = s.get('number')
            if n:
                parts = n.split('.')
                if parent and (len(parts) < 2 or parts[0] != parent.split('.')[0]):
                    add('warn', 'numbering', f'step {n} under {parent}', les['id'], les['pages'][0])
                last = parts[-1]
                if last.isdigit() and int(last) != expect and not les.get('continued'):
                    add('warn', 'numbering', f'expected {expect} but found {n}' + (f' under {parent}' if parent else ''), les['id'], les['pages'][0])
                if last.isdigit():
                    expect = int(last) + 1
            mins, kids = num(s.get('minutes')), [num(c.get('minutes')) for c in s.get('sections', [])]
            if mins and kids and all(kids):
                lo, hi = sum(k[0] for k in kids), sum(k[1] for k in kids)
                if not (lo <= mins[1] and mins[0] <= hi):
                    add('warn', 'minutes', f"«{s.get('heading')}» says {s['minutes']} min, its steps add up to {lo}-{hi}", les['id'], les['pages'][0])
            if not s.get('items') and not s.get('sections'):
                add('warn', 'empty-section', f"«{s.get('heading')}» has no content", les['id'], les['pages'][0])
            level(s.get('sections', []), n or parent)
        return nums
    level(les['sections'], None)


def check_week_day(pack, per_week, add):
    prev = None
    for les in pack['lessons']:
        try:
            w, d = int(les['keys']['week']), int(les['keys']['day'])
        except (TypeError, ValueError):
            prev = None
            continue
        if prev:
            pw, pd = prev[0], prev[1]
            ok = (w == pw and d == pd + 1) or (w > pw and d == 1 and (pd == per_week or True))
            if (w, d) <= (pw, pd):
                add('error', 'sequence', f'week {w} day {d} comes after week {pw} day {pd}', les['id'], les['pages'][0])
            elif w == pw and d != pd + 1:
                add('error', 'sequence', f'week {w}: day {d} follows day {pd} (days missing or misread)', les['id'], les['pages'][0])
            elif w > pw and (d != 1 or pd != per_week):
                add('warn', 'sequence', f'week {pw} ends at day {pd}, week {w} starts at day {d}', les['id'], les['pages'][0])
            if w > pw + 1:
                add('info', 'week-gap', f'no day pages for week(s) {pw + 1}–{w - 1} (assessment/review weeks?)', les['id'], les['pages'][0])
        prev = (w, d, les['id'])


def check_chapter_days(pack, add):
    by_group = {}
    for les in pack['lessons']:
        by_group.setdefault(les['group'], []).append(les)
    for gid, items in by_group.items():
        end = 0
        for les in items:
            r = day_range(les['keys'].get('days'))
            if not r:
                continue
            if r[0] != end + 1:
                add('error', 'sequence', f"days {les['keys']['days']} follow day {end} in this chapter (gap or overlap)", les['id'], les['pages'][0])
            end = max(end, r[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide')
    a = ap.parse_args()
    cfg = load_state(a.state)
    for g in cfg['guides']:
        if a.guide and g['id'] != a.guide:
            continue
        pack = read_json(work(a.state, 'packs', f"{g['id']}.json"))
        if not pack:
            continue
        res = verify(cfg, g, pack)
        write_json(work(a.state, 'checks', f"{g['id']}.json"), res)
        print(f"{g['id']}: {res['groups']} groups, {res['lessons']} lessons — "
              f"{res['counts']['error']} errors, {res['counts']['warn']} warnings, {res['counts']['info']} notes")


if __name__ == '__main__':
    main()
