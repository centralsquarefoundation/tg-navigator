"""Build the deployable site for a state: the shared app (app/) + the state's checked packs.

  python engine/publish.py haryana [--allow-errors]
  -> build/<state>/site/  (index.html, app.js, styles.css, sw.js, data/*.json, pages/<doc>/*.webp, brand/*)

Refuses to publish a guide whose checks still have errors (placement/coverage problems) unless
--allow-errors is given; those lessons are then hidden, never shown in an unknown place.
"""
import argparse
import hashlib
import json
import shutil

from common import ROOT, build, load_state, read_json, state_dir, work, write_json


def slim_section(s):
    out = {k: s[k] for k in ('number', 'heading', 'minutes') if s.get(k)}
    out['items'] = [{k: v for k, v in i.items() if k in ('type', 'text', 'rows', 'desc')} for i in s.get('items', [])]
    out['sections'] = [slim_section(c) for c in s.get('sections', [])]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--allow-errors', action='store_true')
    a = ap.parse_args()
    cfg = load_state(a.state)
    site = build(a.state, 'site', 'x').parent
    data_dir = site / 'data'
    data_dir.mkdir(parents=True, exist_ok=True)
    lock = read_json(state_dir(a.state) / 'sources.lock.json', {})
    guides, files, blocked = [], [], []
    for g in cfg['guides']:
        pack = read_json(work(a.state, 'packs', f"{g['id']}.json"))
        checks = read_json(work(a.state, 'checks', f"{g['id']}.json"))
        if not pack or not checks:
            print(f"skip {g['id']}: not assembled/verified yet")
            continue
        bad = {i['lesson'] for i in checks['issues'] if i['level'] == 'error'}
        missing = [i for i in checks['issues'] if i['level'] == 'error' and i['code'] in ('not-transcribed', 'bad-json')]
        if (bad or missing) and not a.allow_errors:
            blocked.append(g['id'])
            print(f"BLOCKED {g['id']}: {checks['counts']['error']} errors (run with --allow-errors to publish the rest)")
            continue
        warned = {i['lesson'] for i in checks['issues'] if i['level'] == 'warn'}
        lessons = []
        for l in pack['lessons']:
            if l['id'] in bad:
                continue
            lessons.append({'id': l['id'], 'group': l['group'], 'keys': l['keys'], 'intro': l['intro'],
                            'sections': [slim_section(s) for s in l['sections']],
                            'shared': [slim_section(s) for s in l.get('shared', [])],
                            'pages': l['pages'], 'printed_pages': l['printed_pages'],
                            **({'notice': l['notice']} if l.get('notice') else {}),
                            **({'printed_keys': l['printed_keys']} if l.get('printed_keys') else {}),
                            'check': 'flagged' if l['id'] in warned else 'auto-checked'})
        used = {l['group'] for l in lessons}
        groups = [{k: grp.get(k) for k in ('id', 'key', 'title', 'ordinal', 'opener_page')} |
                  {'intro': [slim_section(s) for s in grp.get('intro', [])]} for grp in pack['groups'] if grp['id'] in used]
        out = {'guide': g['id'], 'groups': groups, 'lessons': lessons}
        name = f"data/{g['id']}.json"
        write_json(site / name, out, compact=True)
        files.append(name)
        prof = g['profileData']
        lo, hi = (int(x) for x in g['pages']['guide'].split('-'))
        sections = [{'title': s['title'], 'pages': s['pages']} for s in g.get('sections', [])] or []
        if g['pages'].get('plan'):
            p0, _, p1 = g['pages']['plan'].partition('-')
            sections.insert(0, {'title': {'hi': 'वार्षिक / अकादमिक योजना', 'en': 'Annual / academic plan'}, 'pages': [int(p0), int(p1 or p0)]})
        sections.append({'title': {'hi': 'पूरी संदर्शिका, पहले पृष्ठ से', 'en': 'Whole guide from the first page'}, 'pages': [lo, hi]})
        guides.append({'id': g['id'], 'doc': g['doc'], 'subject': g['subject'], 'subjectLabel': prof['subject'],
                       'grade': g['grade'], 'gradeLabel': g.get('gradeLabel'), 'labels': prof['hierarchy']['labels'],
                       'keys': prof['hierarchy']['keys'], 'groupBy': prof['hierarchy']['group_by'],
                       'pageCount': lock.get(g['doc'], {}).get('pages', hi), 'sections': sections,
                       'lessonCount': len(lessons), 'file': name})
    # order: subjects as configured, grades ascending
    guides.sort(key=lambda x: (x['grade'], x['subject']))
    brand = dict(cfg.get('brand', {}))
    brand_files = []
    (site / 'brand').mkdir(exist_ok=True)
    for key in ('logos', 'footerLogos'):
        out = []
        for l in brand.get(key, []):
            src = state_dir(a.state) / l['file']
            shutil.copy2(src, site / 'brand' / src.name)
            out.append({'src': f'brand/{src.name}', 'alt': l['alt']})
            brand_files.append(f'brand/{src.name}')
        brand[key] = out
    h = hashlib.sha256(json.dumps([read_json(site / f) for f in files], ensure_ascii=False).encode())
    for f in sorted((ROOT / 'app').rglob('*')):
        if f.is_file():
            h.update(f.read_bytes())
    digest = h.hexdigest()[:10]
    index = {'version': digest, 'state': {k: cfg.get(k) for k in ('id', 'label', 'edition', 'appTitle', 'sourceNotice')} | {'brand': brand},
             'guides': guides}
    write_json(data_dir / 'index.json', index)
    # app shell
    for f in (ROOT / 'app').rglob('*'):
        if f.is_file():
            dest = site / f.relative_to(ROOT / 'app')
            dest.parent.mkdir(parents=True, exist_ok=True)
            text_types = ('.html', '.js', '.css', '.webmanifest')
            if f.suffix in text_types:
                s = f.read_text(encoding='utf-8').replace('__VERSION__', digest)
                s = s.replace('__DATA_FILES__', ', '.join(json.dumps(x) for x in files))
                s = s.replace('__BRAND_FILES__', ', '.join(json.dumps(x) for x in brand_files))
                dest.write_text(s, encoding='utf-8')
            else:
                shutil.copy2(f, dest)
    print(f'site: {site}  version {digest}  guides: {[g["id"] for g in guides]}  blocked: {blocked}')


if __name__ == '__main__':
    main()
