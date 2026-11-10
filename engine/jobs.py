"""Create transcription job sheets for vision transcribers (Claude Code subagents or any
vision-capable model run by an operator).

  python engine/jobs.py haryana --guide hr-hindi-g2 [--part lessons|plan | --pages 16-171] --batch 10

Each job sheet = generic instructions (engine/prompts/transcribe.md) + the guide profile's
layout notes + the list of pages with their image paths + where to write each page's JSON.
Pages whose JSON already exists are skipped, so jobs can be regenerated after a partial run.
"""
import argparse
import json

from common import ROOT, build, guide, load_state, parse_pages, work


def sheet(cfg, g, pages, out_dir):
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
        a = build(cfg['id'], 'vision', g['doc'], f'p{p:03d}-a.png')
        b = build(cfg['id'], 'vision', g['doc'], f'p{p:03d}-b.png')
        lines.append(f'- page {p}: images `{a}` and `{b}` → write `{out_dir / f"p{p:03d}.json"}`')
    lines += ['', 'When all files are written, reply with one line per page: page number, page_kind, unit keys, and any uncertainty.']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--guide', required=True)
    ap.add_argument('--pages')
    ap.add_argument('--part', default='lessons')
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--tag', default='')
    a = ap.parse_args()
    cfg = load_state(a.state)
    g = guide(cfg, a.guide)
    out_dir = work(a.state, 'vision', g['doc'], 'x').parent
    spec = a.pages or g['pages'].get(a.part, '')
    todo = [p for p in parse_pages(spec) if not (out_dir / f'p{p:03d}.json').exists()]
    made = []
    for i in range(0, len(todo), a.batch):
        chunk = todo[i:i + a.batch]
        name = f"{g['id']}{a.tag}-p{chunk[0]:03d}-{chunk[-1]:03d}.md"
        path = build(a.state, 'jobs', name)
        path.write_text(sheet(cfg, g, chunk, out_dir), encoding='utf-8')
        made.append(str(path))
    print(json.dumps({'guide': g['id'], 'pages': len(todo), 'jobs': made}, indent=1))


if __name__ == '__main__':
    main()
