"""Shared helpers: locate a state's config, its source PDFs and its working folders.

Nothing here knows about any particular state or guide layout. State-specific facts live in
states/<state>/state.json and states/<state>/guides/*.profile.json.

Source PDFs are NOT committed (they are large and the rights stay with the publisher). Point
TG_SOURCES (or --sources) at the folder holding the files named in state.json; their SHA-256 is
recorded in states/<state>/sources.lock.json so a changed file is detected.
"""
import hashlib
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')


def state_dir(state):
    d = ROOT / 'states' / state
    if not (d / 'state.json').exists():
        raise SystemExit(f'no such state: {d}/state.json')
    return d


def load_state(state):
    d = state_dir(state)
    cfg = json.loads((d / 'state.json').read_text(encoding='utf-8'))
    for g in cfg['guides']:
        g['profileData'] = json.loads((d / g['profile']).read_text(encoding='utf-8')) if (d / g['profile']).exists() else {}
    return cfg


def guide(cfg, gid):
    for g in cfg['guides']:
        if g['id'] == gid:
            return g
    raise SystemExit(f'no guide {gid}')


def document(cfg, did):
    for d in cfg['documents']:
        if d['id'] == did:
            return d
    raise SystemExit(f'no document {did}')


def parse_pages(spec):
    """'9-14,20' -> [9..14, 20]"""
    out = []
    for part in str(spec).split(','):
        if part.strip():
            a, _, b = part.partition('-')
            out += list(range(int(a), int(b or a) + 1))
    return out


def sources_dir(arg=None):
    p = arg or os.environ.get('TG_SOURCES') or str(pathlib.Path.home() / 'Downloads')
    return pathlib.Path(p)


def source_path(g, src=None):
    p = sources_dir(src) / g['file']
    if not p.exists():
        raise SystemExit(f'missing source PDF {p} (set TG_SOURCES)')
    return p


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 22), b''):
            h.update(chunk)
    return h.hexdigest()


def work(state, *parts):
    p = state_dir(state).joinpath('work', *parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def build(state, *parts):
    """Regenerable, uncommitted outputs (page renders, site)."""
    p = ROOT.joinpath('build', state, *parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def read_json(p, default=None):
    p = pathlib.Path(p)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else default


def read_page(p):
    """Read one transcription JSON. Trailing commas (a common model slip that cannot change content)
    are tolerated; anything else invalid returns None so verify.py reports the page as bad-json."""
    p = pathlib.Path(p)
    if not p.exists():
        return None
    text = p.read_text(encoding='utf-8')
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re
        try:
            return json.loads(re.sub(r',(\s*[}\]])', r'\1', text))
        except json.JSONDecodeError:
            return None


def write_json(p, data, compact=False):
    p = pathlib.Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':')) if compact else json.dumps(data, ensure_ascii=False, indent=1)
    p.write_text(text + '\n', encoding='utf-8')
