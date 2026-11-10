"""Render every page of every guide of a state.

  python engine/render.py haryana [--doc ID] [--sources DIR]

Outputs (regenerable, under build/<state>/):
  site/pages/<doc>/p###.webp   page images shown in the app ("original page") and the review report
  vision/<doc>/p###-a.png      top half, for the vision transcriber
  vision/<doc>/p###-b.png      bottom half (the halves overlap, so no line is cut in both)
Also records each PDF's SHA-256 in states/<state>/sources.lock.json.
"""
import argparse
import io
import sys
from concurrent.futures import ProcessPoolExecutor

import fitz
from PIL import Image

from common import build, document, load_state, read_json, sha256, source_path, state_dir, write_json

APP_WIDTH = 1100        # px; legible on phones when zoomed, ~100-200 KB as WebP
VISION_WIDTH = 1400     # px per half; keeps each half under the vision model's resize limit
HALVES = {'a': (0.0, 0.54), 'b': (0.46, 1.0)}


def render_guide(state, gid, src):
    cfg = load_state(state)
    g = document(cfg, gid)
    pdf = source_path(g, src)
    doc = fitz.open(pdf)
    done = 0
    for i, page in enumerate(doc, start=1):
        r = page.rect
        app = build(state, 'site', 'pages', gid, f'p{i:03d}.webp')
        if not app.exists():
            z = APP_WIDTH / r.width
            pix = page.get_pixmap(matrix=fitz.Matrix(z, z))
            Image.frombytes('RGB', (pix.width, pix.height), pix.samples).save(app, 'WEBP', quality=62, method=5)
        for half, (y0, y1) in HALVES.items():
            out = build(state, 'vision', gid, f'p{i:03d}-{half}.png')
            if out.exists():
                continue
            clip = fitz.Rect(0, r.height * y0, r.width, r.height * y1)
            z = VISION_WIDTH / r.width
            page.get_pixmap(matrix=fitz.Matrix(z, z), clip=clip).save(out)
        done += 1
    return gid, doc.page_count, str(pdf)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--doc')
    ap.add_argument('--sources')
    a = ap.parse_args()
    cfg = load_state(a.state)
    ids = [a.doc] if a.doc else [d['id'] for d in cfg['documents']]
    lock_path = state_dir(a.state) / 'sources.lock.json'
    lock = read_json(lock_path, {})
    with ProcessPoolExecutor(max_workers=min(6, len(ids))) as ex:
        for gid, n, pdf in ex.map(render_guide, [a.state] * len(ids), ids, [a.sources] * len(ids)):
            digest = sha256(pdf)
            if gid in lock and lock[gid]['sha256'] != digest:
                print(f'WARNING {gid}: source PDF changed since last lock ({lock[gid]["sha256"][:12]} -> {digest[:12]})')
            lock[gid] = {'file': document(cfg, gid)['file'], 'pages': n, 'sha256': digest}
            print(f'{gid}: {n} pages rendered', flush=True)
    write_json(lock_path, lock)


if __name__ == '__main__':
    main()
