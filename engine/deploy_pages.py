"""Publish every built state site to the repo's gh-pages branch (GitHub Pages).

  python engine/deploy_pages.py [--remote origin] [--dry-run]

Layout on the branch:  /<state>/...  (each build/<state>/site/)  and  /index.html  listing the states
(it opens the only state directly when there is just one). The branch is rebuilt as a single fresh
commit and force-pushed, so old page images do not pile up in git history.
Refuses to run if a state's build has guides blocked by verify errors.
"""
import argparse
import html
import json
import os
import shutil
import stat
import subprocess
import sys

from common import ROOT, load_state

OUT = ROOT / 'build' / '_gh-pages'


def git(*args, cwd=OUT):
    subprocess.run(['git', *args], cwd=cwd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--remote', default='origin')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    url = subprocess.run(['git', 'remote', 'get-url', a.remote], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout.strip()
    states = []
    for d in sorted((ROOT / 'build').iterdir()):
        site = d / 'site'
        if not (site / 'index.html').exists() or d.name.startswith('_'):
            continue
        errors = {c.stem: json.loads(c.read_text(encoding='utf-8'))['counts']['error']
                  for c in (ROOT / 'states' / d.name / 'work' / 'checks').glob('*.json')}
        if any(errors.values()):
            sys.exit(f"{d.name}: verify errors {errors}; fix them and re-run the pipeline before deploying")
        states.append((d.name, site, load_state(d.name)))
    if not states:
        sys.exit('nothing built: run engine/pipeline.py <state> first')
    if OUT.exists():
        def unlock(fn, path, _):          # git marks its objects read-only on Windows
            os.chmod(path, stat.S_IWRITE)
            fn(path)
        shutil.rmtree(OUT, onexc=unlock)
    OUT.mkdir(parents=True)
    for name, site, _ in states:
        shutil.copytree(site, OUT / name)
    links = ''.join(f"<li><a href='{n}/'>{html.escape(c['label'].get('hi', n))} · {html.escape(c['label'].get('en', n))}</a></li>"
                    for n, _, c in states)
    jump = f"<meta http-equiv='refresh' content='0; url={states[0][0]}/'>" if len(states) == 1 else ''
    (OUT / 'index.html').write_text(
        "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>Teacher Guide Navigator</title>{jump}<body style='font-family:sans-serif;padding:16px'>"
        f"<h1>Teacher Guide Navigator</h1><ul>{links}</ul></body>", encoding='utf-8')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')   # serve files as-is (no Jekyll processing)
    git('init', '-q', '-b', 'gh-pages')
    for key in ('user.name', 'user.email'):     # same identity as the main repo
        v = subprocess.run(['git', 'config', key], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        if v:
            git('config', key, v)
    git('config', 'core.autocrlf', 'false')
    git('add', '-A')
    git('commit', '-q', '-m', 'Publish built sites')
    if a.dry_run:
        print(f'dry run: built {OUT}, not pushed')
        return
    git('push', '-q', '--force', url, 'gh-pages:gh-pages')
    print('pushed gh-pages:', ', '.join(n for n, _, _ in states))


if __name__ == '__main__':
    main()
