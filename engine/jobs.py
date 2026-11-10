"""Create transcription job sheets for vision transcribers (Claude Code subagents or any
vision-capable model run by an operator).

  python engine/jobs.py haryana --guide hr-hindi-g2 [--part lessons|plan | --pages 16-171] --batch 10

Each job sheet = generic instructions (engine/prompts/transcribe.md) + the guide profile's
layout notes + the list of pages with their image paths + where to write each page's JSON.
Pages whose JSON already exists are skipped, so jobs can be regenerated after a partial run.
"""
import argparse
import json

from common import ROOT, build, guide, load_state, parse_pages, read_json, read_page, work


def figure_sheet(cfg, g, pages, out_dir, doc):
    prof = g['profileData']
    lines = [(ROOT / 'engine/prompts/figures.md').read_text(encoding='utf-8'), '',
             '## PROFILE (how this guide prints its unit keys)', 'Unit keys: ' + ', '.join(prof['hierarchy']['keys'])]
    lines += [f'- {n}' for n in prof['layout_notes']]
    lines += ['', '## PAGES TO DO', 'For each page: Read the image, then Write the JSON file. Do every page listed.']
    for p in pages:
        img = build(cfg['id'], 'site', 'pages', doc, f'p{p:03d}.webp')
        lines.append(f'- page {p}: image `{img}` → write `{out_dir / f"p{p:03d}.json"}`')
    lines += ['', 'When done, reply with one line per page: page number and number of pictures found.']
    return '\n'.join(lines)


def proof_sheet(cfg, g, pages, out_dir, doc):
    prof = g['profileData']
    lines = [(ROOT / 'engine/prompts/proofread.md').read_text(encoding='utf-8'), '',
             '## PROFILE: ' + prof.get('id', g['profile'])]
    lines += [f'- {n}' for n in prof['layout_notes']]
    lines += ['', '## PAGES TO PROOFREAD']
    for p in pages:
        qs = [build(cfg['id'], 'vision', doc, f'p{p:03d}-q{k}.png') for k in range(1, 5)]
        if all(q.exists() for q in qs):   # sharper overlapping bands, top to bottom
            imgs = ', '.join(f'`{q}`' for q in qs)
        else:
            imgs = f"`{build(cfg['id'], 'vision', doc, f'p{p:03d}-a.png')}` and `{build(cfg['id'], 'vision', doc, f'p{p:03d}-b.png')}`"
        lines.append(f'- page {p}: images {imgs}; JSON `{out_dir / f"p{p:03d}.json"}`')
    return '\n'.join(lines)


def keys_sheet(cfg, g, pages, out_dir, doc):
    prof = g['profileData']
    lines = [(ROOT / 'engine/prompts/keys.md').read_text(encoding='utf-8'), '',
             '## PROFILE (how this guide prints its location)', 'Unit keys: ' + ', '.join(prof['hierarchy']['keys'])]
    lines += [f'- {n}' for n in prof['layout_notes'][:3]]
    lines += ['', '## PAGES']
    for p in pages:
        img = build(cfg['id'], 'site', 'pages', doc, f'p{p:03d}.webp')
        lines.append(f'- page {p}: image `{img}` → write `{out_dir / f"p{p:03d}.json"}`')
    lines += ['', 'Reply with one line per page: page, page_kind, keys per unit.']
    return '\n'.join(lines)


def lesson_text(les):
    """The lesson as plain numbered lines (headings and items), for text-only passes."""
    out = []
    def walk(ss, depth):
        for s in ss:
            head = ' '.join(x for x in (s.get('number'), s.get('heading')) if x)
            if head:
                out.append('  ' * depth + '## ' + head)
            for it in s.get('items', []):
                t = it.get('text') or ''
                if it.get('rows'):
                    t = ' | '.join(' ; '.join(str(c) for c in r) for r in it['rows'])
                if t:
                    out.append('  ' * depth + '- ' + t)
            walk(s.get('sections', []), depth + 1)
    for t in les.get('intro') or []:
        out.append('- ' + t)
    walk(les['sections'], 0)
    return '\n'.join(out)


def materials_jobs(cfg, g, batch):
    """One sheet per batch of lessons; skips lessons already present in an output file."""
    pack = read_json(work(cfg['id'], 'packs', f"{g['id']}.json"))
    out_dir = work(cfg['id'], 'materials', g['id'], 'x').parent
    done = set()
    for f in out_dir.glob('*.json'):
        done |= set((read_page(f) or {}).keys())
    todo = [l for l in pack['lessons'] if l['id'] not in done]
    head = (ROOT / 'engine/prompts/materials.md').read_text(encoding='utf-8')
    made = []
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        out = out_dir / f"{chunk[0]['id']}--{chunk[-1]['id']}.json"
        body = [head, '', f'## OUTPUT FILE\nWrite `{out}` (one JSON object with all {len(chunk)} lesson ids below).', '', '## LESSONS']
        for les in chunk:
            where = ', '.join(f'{k} {v}' for k, v in les['keys'].items())
            body += ['', f"### {les['id']}  ({where})", lesson_text(les)]
        path = build(cfg['id'], 'jobs', f"mat-{chunk[0]['id']}.md")
        path.write_text('\n'.join(body), encoding='utf-8')
        made.append(str(path))
    return len(todo), made


def sheet(cfg, g, pages, out_dir, doc):
    prof = g['profileData']
    lines = [(ROOT / 'engine/prompts/transcribe.md').read_text(encoding='utf-8'), '',
             '## PROFILE: ' + prof.get('id', g['profile']),
             f"Guide: {g['id']} — {cfg['label']['en']} {prof.get('subject', {}).get('en', '')} grade {g['grade']}.",
             'Unit keys: ' + ', '.join(prof['hierarchy']['keys']), '']
    lines += [f'- {n}' for n in prof['layout_notes']]
    kinds = prof.get('transcribe_shared_on', [])
    if kinds:
        lines.append(f"- Transcribe the full content (into 'shared' when it belongs to no unit) for page kinds: {', '.join(kinds)}. "
                     "For other page kinds only fill printed_page, page_kind, header and notes.")
    lines += ['', '## PAGES TO DO', 'For each page: Read both images, then Write the JSON file. Do every page listed.']
    for p in pages:
        a = build(cfg['id'], 'vision', doc, f'p{p:03d}-a.png')
        b = build(cfg['id'], 'vision', doc, f'p{p:03d}-b.png')
        lines.append(f'- page {p}: images `{a}` and `{b}` → write `{out_dir / f"p{p:03d}.json"}`')
    lines += ['', 'When all files are written, reply with one line per page: page number, page_kind, unit keys, and any uncertainty.']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide', required=True)
    ap.add_argument('--pages')
    ap.add_argument('--part', default='lessons')
    ap.add_argument('--doc', help='only this volume of a multi-volume guide')
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--tag', default='')
    ap.add_argument('--kind', default='transcribe', choices=['transcribe', 'figures', 'proofread', 'keys', 'materials'])
    a = ap.parse_args()
    cfg = load_state(a.state)
    g = guide(cfg, a.guide)
    if a.kind == 'materials':      # works on assembled lessons, not pages
        n, made = materials_jobs(cfg, g, a.batch)
        print(json.dumps({'guide': g['id'], 'lessons': n, 'jobs': made}, indent=1))
        return
    made, total = [], 0
    for part in g['parts']:
        if a.doc and part['doc'] != a.doc:
            continue
        out_dir = work(a.state, {'figures': 'figures', 'keys': 'keys'}.get(a.kind, 'vision'), part['doc'], 'x').parent
        spec = a.pages or part['pages'].get(a.part, '')
        todo = [p for p in parse_pages(spec) if (out_dir / f'p{p:03d}.json').exists() == (a.kind == 'proofread')]
        total += len(todo)
        for i in range(0, len(todo), a.batch):
            chunk = todo[i:i + a.batch]
            name = f"{ {'figures': 'fig-', 'proofread': 'proof-', 'keys': 'keys-'}.get(a.kind, '') }{g['id']}{a.tag}-{part['doc']}-p{chunk[0]:03d}-{chunk[-1]:03d}.md"
            path = build(a.state, 'jobs', name)
            make = {'figures': figure_sheet, 'proofread': proof_sheet, 'keys': keys_sheet}.get(a.kind, sheet)
            path.write_text(make(cfg, g, chunk, out_dir, part['doc']), encoding='utf-8')
            made.append(str(path))
    print(json.dumps({'guide': g['id'], 'pages': total, 'jobs': made}, indent=1))


if __name__ == '__main__':
    main()
