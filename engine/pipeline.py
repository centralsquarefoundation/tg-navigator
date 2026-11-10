"""Run every step after transcription for a state, in order.

  python engine/pipeline.py haryana [--sources DIR] [--allow-errors]

  textlayer -> assemble -> reconcile -> verify -> publish -> review
(render.py and the transcription jobs come before this; see docs/NEW_STATE.md.)
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(*args):
    print('$', ' '.join(args), flush=True)
    r = subprocess.run([sys.executable, *args])
    if r.returncode:
        raise SystemExit(r.returncode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    ap.add_argument('--sources')
    ap.add_argument('--allow-errors', action='store_true')
    a = ap.parse_args()
    src = ['--sources', a.sources] if a.sources else []
    run(str(HERE / 'textlayer.py'), a.state, *src)
    for step in ('assemble.py', 'reconcile.py', 'verify.py'):
        run(str(HERE / step), a.state)
    run(str(HERE / 'publish.py'), a.state, *(['--allow-errors'] if a.allow_errors else []))
    run(str(HERE / 'review.py'), a.state)


if __name__ == '__main__':
    main()
