"""Assemble per-page transcriptions into a guide pack: groups (week / chapter / ...) and lessons.

  python engine/assemble.py haryana [--guide ID]
  -> states/<state>/work/packs/<guide>.json

Generic: the profile's hierarchy.keys name the unit keys (e.g. ["week","day"] or
["chapter","days"]) and hierarchy.group_by names the key that groups lessons. A unit that has the
same keys as the previous unit and is marked as continuing is merged into it (content that runs
over a page break). Nothing here knows any guide's wording.
"""
import argparse
import difflib
import json
import re

from common import guide, load_state, parse_pages, read_json, read_page, work, write_json


def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()


def similar(a, b, threshold=0.85):
    """Same group key printed slightly differently (a stray space or mark) on another page.
    Purely numeric keys must match exactly."""
    a, b = norm(a), norm(b)
    if not a or not b or a.isdigit() or b.isdigit():
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= threshold


def keyslug(v):
    v = norm(str(v))
    if re.fullmatch(r'[0-9]+', v):
        return f'{int(v):02d}'
    if re.fullmatch(r'[0-9]+(-[0-9]+)?', v):
        return v
    return None


def same_section(a, b):
    """Same printed section: same number, and same heading unless one side has no heading
    (a page-break continuation often repeats the number but not the heading)."""
    na, nb = norm(a.get('number')), norm(b.get('number'))
    ha, hb = norm(a.get('heading')), norm(b.get('heading'))
    return na == nb and (ha == hb or not ha or not hb) and (na or ha == hb)


def last_leaf(section):
    """The step that was being printed last: the deepest last sub-step."""
    while section.get('sections'):
        section = section['sections'][-1]
    return section


def merge_sections(into, more):
    """Append `more` sections to `into`, merging the boundary section when it continues.
    Continuation text with no heading of its own belongs to the step that was being printed last
    (not to the block above it), so it keeps its place after that step's earlier lines."""
    if into and more:
        first = more[0]
        untitled = first.get('heading') is None and first.get('number') is None
        if untitled or same_section(into[-1], first):
            target = into[-1]
            if first.get('items'):
                (last_leaf(target) if (untitled or not first.get('sections')) and target.get('sections') else target
                 ).setdefault('items', []).extend(first['items'])
            merge_sections(target.setdefault('sections', []), first.get('sections', []))
            more = more[1:]
    into.extend(more)


def add_shared(lesson, data):
    """Page-level boxes outside the units (multigrade plans, a chapter-end instruction printed
    across all columns) belong to every unit on that page; add each once."""
    have = {json.dumps(x, ensure_ascii=False, sort_keys=True) for x in lesson['shared']}
    for s in data.get('shared', []):
        c = clean_section(s)
        k = json.dumps(c, ensure_ascii=False, sort_keys=True)
        if k not in have and (c['items'] or c['sections']):
            lesson['shared'].append(c); have.add(k)


def restarts(old, new):
    """True when `new` starts its numbering again (e.g. block 1 after block 4): a new unit that
    happens to carry the same printed keys, not a continuation."""
    def first_num(ss):
        for s in ss:
            if re.fullmatch(r'\d+', s.get('number') or ''):
                return int(s['number'])
        return None
    last = [int(s['number']) for s in old if re.fullmatch(r'\d+', s.get('number') or '')]
    first = first_num(new)
    return bool(last) and first is not None and first < last[-1] and first == 1


def clean_section(s):
    return {'number': norm(s.get('number')) or None, 'heading': norm(s.get('heading')) or None,
            'minutes': norm(s.get('minutes')) or None,
            'items': [clean_item(i) for i in s.get('items', []) if clean_item(i)],
            'sections': [clean_section(c) for c in s.get('sections', [])]}


def clean_item(i):
    if isinstance(i, str):
        i = {'type': 'text', 'text': i}
    out = {'type': i.get('type') or 'text'}
    if i.get('text'):
        out['text'] = norm(i['text'])
    if i.get('rows'):
        out['rows'] = [[norm(c) for c in r] for r in i['rows']]
    if i.get('desc'):
        out['desc'] = norm(i['desc'])
    return out if len(out) > 1 else None


def assemble(cfg, g):
    prof = g['profileData']
    keys = prof['hierarchy']['keys']
    group_key = prof['hierarchy']['group_by']
    groups, lessons, page_index, missing, plan = [], [], [], [], []
    current_group = None

    def group_for(value, page, title=None, intro=None):
        nonlocal current_group
        if current_group and (norm(current_group['key']) == norm(value) or similar(current_group['key'], value)):
            return current_group
        current_group = {'id': None, 'key': norm(value), 'title': title or norm(value), 'ordinal': len(groups) + 1,
                         'intro': intro or [], 'pages': [page], 'opener_page': None, 'doc': doc}
        slug = keyslug(value)
        current_group['id'] = f"{g['id']}-{group_key[0]}{slug if slug and slug.isdigit() else f'{len(groups) + 1:02d}'}"
        groups.append(current_group)
        return current_group

    anomalies = (read_json(work(cfg['id'], 'x').parent.parent / 'anomalies.json', {}) or {}).get(g['id'], [])
    pending_opener = None
    for part in g['parts']:
      doc = part['doc']
      vdir = work(cfg['id'], 'vision', doc, 'x').parent
      for p in parse_pages(part['pages'].get('lessons', '')):
        data = read_page(vdir / f'p{p:03d}.json')
        if data is None:
            missing.append({'doc': doc, 'page': p})
            continue
        kind = data.get('page_kind')
        page_index.append({'doc': doc, 'page': p, 'printed': data.get('printed_page'), 'kind': kind,
                           'units': [u.get('keys') for u in data.get('units', [])]})
        if kind == 'unit_opener':
            pending_opener = {'page': p, 'title': norm(data.get('header')),
                              'intro': [clean_section(s) for s in data.get('shared', [])]}
            continue
        if kind != 'lesson':
            continue
        fix = next((a for a in anomalies if a['page'] == p and a.get('doc', g['doc']) == doc and a.get('keys')), None)
        for u in data.get('units', []):
            k = {name: (norm(str(u.get('keys', {}).get(name))) if u.get('keys', {}).get(name) is not None else None) for name in keys}
            printed = None
            if fix:   # evidence-backed correction of a misprinted key (states/<state>/anomalies.json)
                printed = dict(k)
                k.update({n: str(v) for n, v in fix['keys'].items()})
            gv = k.get(group_key) or (current_group['key'] if current_group else None)
            if pending_opener and (not current_group or norm(gv) != current_group['key']):
                grp = group_for(gv, p, pending_opener['title'] or gv, pending_opener['intro'])
                grp['opener_page'] = pending_opener['page']; grp['pages'].insert(0, pending_opener['page'])
                pending_opener = None
            else:
                grp = group_for(gv, p)
            if p not in grp['pages']:
                grp['pages'].append(p)
            sections = [clean_section(s) for s in u.get('sections', [])]
            intro = [norm(x) for x in u.get('intro', []) if norm(x)]
            # same unit = same group and same non-group keys (the group key itself may be printed
            # slightly differently on a later page; the group match above already tolerates that)
            prev = next((l for l in reversed(lessons) if l['group'] == grp['id'] and
                         all(norm(l['keys'].get(n)) == norm(k.get(n)) for n in keys if n != group_key)), None)
            # a continuation page that prints no keys at all belongs to the unit just before it
            if (prev is None and lessons and all(k.get(n) is None for n in keys)
                    and lessons[-1]['doc'] == doc and p - lessons[-1]['pages'][-1] <= 1):
                prev = lessons[-1]
                prev.setdefault('notes', []).append(f'page {p} prints no keys; joined as a continuation of the previous page')
            if prev and prev['doc'] == doc and (u.get('continues_from_previous_page') or (p - prev['pages'][-1] <= 1 and not restarts(prev['sections'], sections))):
                merge_sections(prev['sections'], sections)
                for line in intro:   # the same printed box repeats on continuation pages
                    if not any(line == x or difflib.SequenceMatcher(None, line, x).ratio() >= 0.8 for x in prev['intro']):
                        prev['intro'].append(line)
                if p not in prev['pages']:
                    prev['pages'].append(p)
                prev['printed_pages'].append(data.get('printed_page'))
                add_shared(prev, data)
                continue
            unit_slug = '-'.join(f'{name[0]}{keyslug(k[name]) or "x"}' for name in keys if name != group_key)
            lid = f"{grp['id']}-{unit_slug}"
            if any(l['id'] == lid for l in lessons):
                lid += f'-p{p:03d}'
            lessons.append({'id': lid, 'group': grp['id'], 'keys': k, 'order': len(lessons) + 1, 'doc': doc,
                            'column': u.get('column'), 'keys_evidence': u.get('keys_evidence'),
                            'intro': intro, 'sections': sections,
                            'shared': [],
                            'pages': [p], 'printed_pages': [data.get('printed_page')],
                            'uncertain': data.get('uncertain', [])})
            add_shared(lessons[-1], data)
            here = [a for a in anomalies if a['page'] == p and a.get('doc', g['doc']) == doc and a.get('notice')]
            if fix or here:
                a = fix or here[0]
                lessons[-1]['notice'] = a.get('notice')
                if printed:
                    lessons[-1]['printed_keys'] = printed
      for p in parse_pages(part['pages'].get('plan', '')):
        data = read_page(vdir / f'p{p:03d}.json')
        if data is None:
            missing.append({'doc': doc, 'page': p})
            continue
        plan.append({'doc': doc, 'page': p, 'kind': data.get('page_kind'), 'shared': [clean_section(s) for s in data.get('shared', [])]})
    # optional printed names for numbered groups (state.json guide.groupNames, e.g. week -> textbook lesson);
    # verify.py checks each name against the group's own transcribed text
    for grp in groups:
        name = (g.get('groupNames') or {}).get(grp['key'])
        if name:
            grp['name'] = norm(name)
    return {'guide': g['id'], 'doc': g['doc'], 'subject': g['subject'], 'grade': g['grade'],
            'gradeLabel': g.get('gradeLabel'), 'hierarchy': prof['hierarchy'], 'groups': groups,
            'lessons': lessons, 'plan': plan, 'page_index': page_index, 'missing_pages': missing}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide')
    a = ap.parse_args()
    cfg = load_state(a.state)
    for g in cfg['guides']:
        if a.guide and g['id'] != a.guide:
            continue
        pack = assemble(cfg, g)
        write_json(work(a.state, 'packs', f"{g['id']}.json"), pack)
        print(f"{g['id']}: {len(pack['groups'])} groups, {len(pack['lessons'])} lessons, "
              f"{len(pack['missing_pages'])} pages not transcribed yet")


if __name__ == '__main__':
    main()
