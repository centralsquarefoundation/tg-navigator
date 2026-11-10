"""Optional human review report (static HTML), built after the automatic checks.

  python engine/review.py haryana
  -> build/<state>/site/review/index.html          overview + every flagged item
  -> build/<state>/site/review/<guide>.html        every lesson: location + outline beside its page

Nothing here is required for publishing: the automatic checks gate publication. This is for a
person who wants to confirm placement (right page -> right week/day/chapter/heading). Ticks are
kept in that reviewer's browser and can be downloaded as a JSON file to send back; drop it in
states/<state>/reviews/ and rerun to show who confirmed what.
"""
import argparse
import html
import json

from common import build, load_state, read_json, state_dir, work

CSS = """
body{font-family:"Noto Sans Devanagari","Noto Sans",system-ui,sans-serif;margin:0;background:#f4f6f9;color:#1d2b3a;line-height:1.5}
header{background:#00316b;color:#fff;padding:12px 16px;position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header a{color:#ffd400} main{max-width:1200px;margin:0 auto;padding:12px}
h1{font-size:22px;margin:0} h2{font-size:19px;margin:20px 0 8px} table{border-collapse:collapse;width:100%;background:#fff}
td,th{border:1px solid #d6dde6;padding:6px 8px;vertical-align:top;font-size:14px;text-align:left} th{background:#e6edf6}
.err{background:#fde8e4}.warn{background:#fff6dc}.ack{background:#eef4ff}.info{color:#5a6878}
.les{display:grid;grid-template-columns:minmax(260px,1fr) minmax(260px,420px);gap:12px;background:#fff;border:1px solid #d6dde6;border-radius:10px;padding:10px;margin:0 0 12px}
.les.flag{border-left:6px solid #ff6600} .les.ok{border-left:6px solid #00cc99}
.where{font-weight:800;color:#00316b} .outline{font-size:14px} .outline li{margin:2px 0}
.pages img{width:100%;border:1px solid #d6dde6;border-radius:6px} .pages a{display:block;margin-bottom:6px}
label.tick{display:inline-flex;gap:6px;align-items:center;font-weight:700;margin:6px 0;min-height:40px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center} button{min-height:40px;font:inherit;padding:4px 12px;border-radius:8px;border:2px solid #00316b;background:#fff;color:#00316b;font-weight:700}
@media(max-width:700px){.les{grid-template-columns:1fr}}
"""

TICK_JS = """
const KEY='tg-review:'+document.body.dataset.guide;
const st=JSON.parse(localStorage.getItem(KEY)||'{}');
for(const cb of document.querySelectorAll('input[data-id]')){cb.checked=!!st[cb.dataset.id];
 cb.addEventListener('change',()=>{if(cb.checked)st[cb.dataset.id]={ok:true,at:new Date().toISOString()};else delete st[cb.dataset.id];
 localStorage.setItem(KEY,JSON.stringify(st));count();});}
function count(){document.getElementById('done').textContent=Object.keys(st).length;}
count();
document.getElementById('export').onclick=()=>{const who=prompt('Reviewer name / समीक्षक का नाम')||'';
 const blob=new Blob([JSON.stringify({guide:document.body.dataset.guide,reviewer:who,confirmed:st},null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='review-'+document.body.dataset.guide+'.json';a.click();};
"""

e = lambda s: html.escape(str(s if s is not None else ''))


def xsum(x):
    """One line per guide: how many pages/lessons each independent placement check agreed on."""
    out = []
    r = x.get('reread') or {}
    if r:
        out.append(f"re-read {r.get('agree', 0)}/{r.get('agree', 0) + r.get('disagree', 0)}")
    t = x.get('textlayer') or {}
    if t.get('agree') or t.get('disagree'):
        out.append(f"PDF text {t['agree']}/{t['agree'] + t['disagree']}")
    ec = x.get('echo') or {}
    if ec.get('agree') or ec.get('disagree'):
        out.append(f"worksheet nos. {ec['agree']}/{ec['agree'] + ec['disagree']}")
    pg = x.get('pages') or {}
    if pg:
        a = sum(v['agree'] for v in pg.values()); b = sum(v['disagree'] for v in pg.values())
        out.append(f"page nos. {a}/{a + b}")
    return ' · '.join(out) or '—'


def outline(sections, depth=0):
    out = []
    for s in sections:
        head = ' '.join(x for x in [s.get('number') or '', s.get('heading') or '(continued)'] if x)
        mins = f" · {s['minutes']} मिनट" if s.get('minutes') else ''
        first = next((i.get('text') for i in s.get('items', []) if i.get('text')), '')
        out.append(f"<li><b>{e(head)}</b>{e(mins)}{('<br><span class=info>' + e(first[:110]) + '…</span>') if first else ''}"
                   f"{('<ul>' + outline(s.get('sections', []), depth + 1) + '</ul>') if s.get('sections') else ''}</li>")
    return ''.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('state')
    a = ap.parse_args()
    cfg = load_state(a.state)
    out_dir = build(a.state, 'site', 'review', 'x').parent
    reviews = {}
    rdir = state_dir(a.state) / 'reviews'
    if rdir.exists():
        for f in rdir.glob('*.json'):
            r = read_json(f)
            reviews.setdefault(r['guide'], {}).update({k: r.get('reviewer', '') for k in r.get('confirmed', {})})
    rows, flagged = [], []
    for g in cfg['guides']:
        pack = read_json(work(a.state, 'packs', f"{g['id']}.json"))
        checks = read_json(work(a.state, 'checks', f"{g['id']}.json"))
        if not pack or not checks:
            continue
        keys = g['profileData']['hierarchy']['keys']
        by_lesson = {}
        for i in checks['issues']:
            by_lesson.setdefault(i['lesson'], []).append(i)
            if i['level'] in ('error', 'warn'):
                flagged.append((g, i))
        groups = {grp['id']: grp for grp in pack['groups']}
        tc = pack.get('reconcile', {}).get('totals', {})
        done = len(reviews.get(g['id'], {}))
        rows.append(f"<tr><td><a href='{g['id']}.html'>{e(g['id'])}</a></td><td>{len(pack['groups'])}</td><td>{len(pack['lessons'])}</td>"
                    f"<td>{checks['counts']['error']}</td><td>{checks['counts']['warn']}</td>"
                    f"<td>{(str(round(100 * tc.get('exact', 0) / tc['checked'])) + '% exact of ' + str(tc['checked'])) if tc.get('checked') else 'no text layer'}</td>"
                    f"<td>{e(xsum(checks.get('crosscheck') or {}))}</td>"
                    f"<td>{done}/{len(pack['lessons'])}</td></tr>")
        cards = []
        for l in pack['lessons']:
            iss = [i for i in by_lesson.get(l['id'], []) if i['level'] in ('error', 'warn')]
            notes = [i for i in by_lesson.get(l['id'], []) if i['level'] == 'info']
            grp = groups.get(l['group'], {})
            where = f"{grp.get('title')} → " + ' · '.join(f"{k}: {l['keys'].get(k)}" for k in keys if k != g['profileData']['hierarchy']['group_by'])
            d = l.get('doc', g['doc'])
            def crops(ss, where=''):
                for s in ss:
                    here = ' '.join(x for x in [s.get('number') or '', s.get('heading') or ''] if x) or where
                    for it in s.get('items', []):
                        if it.get('crop'):
                            yield here, it
                    yield from crops(s.get('sections', []), here)
            figs = list(crops(l['sections'] + l.get('shared', [])))
            fig_html = ''.join(f"<figure style='margin:6px 0'><img loading=lazy src='../{e(it['crop'])}' style='max-width:100%;border:1px solid #d6dde6'><figcaption class=info>under «{e(sec)}» · {e(it.get('desc'))}</figcaption></figure>" for sec, it in figs)
            imgs = ''.join(f"<a href='../pages/{d}/p{p:03d}.webp' target=_blank><img loading=lazy src='../pages/{d}/p{p:03d}.webp' alt='page {p}'></a>" for p in l['pages'])
            cards.append(
                f"<section class='les {'flag' if iss else 'ok'}' id='{e(l['id'])}'><div>"
                f"<div class=where>{e(where)}</div><div class=info>{e(l['id'])} · {e(d)} PDF pages {', '.join(map(str, l['pages']))} · printed {e(', '.join(x or '?' for x in l['printed_pages']))}</div>"
                f"{('<div class=info>Evidence: ' + e(l.get('keys_evidence')) + '</div>') if l.get('keys_evidence') else ''}"
                f"{''.join('<div class=' + ('ack' if i.get('acknowledged') else i['level']) + '>' + e(i['level'].upper() + ' ' + i['code'] + ': ' + i['msg']) + '</div>' for i in iss)}"
                f"{('<ul class=outline>' + ''.join('<li>' + e(x) + '</li>' for x in l['intro']) + '</ul>') if l['intro'] else ''}"
                f"<ul class=outline>{outline(l['sections'])}</ul>"
                f"{('<details open><summary>Pictures (' + str(len(figs)) + ')</summary>' + fig_html + '</details>') if figs else ''}"
                f"{('<details><summary>Transcriber notes (' + str(len(notes)) + ')</summary>' + ''.join('<div class=info>' + e(n['msg']) + '</div>' for n in notes) + '</details>') if notes else ''}"
                f"<label class=tick><input type=checkbox data-id='{e(l['id'])}'> Placement and headings match the page / स्थान व शीर्षक पृष्ठ से मेल खाते हैं</label>"
                f"{('<div class=info>Confirmed earlier by ' + e(reviews[g['id']][l['id']]) + '</div>') if l['id'] in reviews.get(g['id'], {}) else ''}"
                f"</div><div class=pages>{imgs}</div></section>")
        (out_dir / f"{g['id']}.html").write_text(
            f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Review {e(g['id'])}</title>"
            f"<style>{CSS}</style><body data-guide='{e(g['id'])}'><header><h1>Review · {e(g['id'])}</h1><a href='index.html'>← all guides</a>"
            f"<span class=bar>Confirmed: <b id=done>0</b>/{len(pack['lessons'])} <button id=export>Download my review (JSON)</button></span></header><main>"
            f"<p>Each card: the app's location and outline on the left, the original page(s) on the right. Flagged cards (orange edge) first need a look; "
            f"green ones passed every automatic check. Tick when the location and headings match the page.</p>"
            + ''.join(sorted(cards, key=lambda c: 0 if "les flag" in c else 1)) +
            f"</main><script>{TICK_JS}</script></body>", encoding='utf-8')
    flag_rows = ''.join(
        f"<tr class={'ack' if i.get('acknowledged') else i['level']}><td>{e(g['id'])}</td><td>{e(i['level'])}</td><td>{e(i['code'])}</td>"
        f"<td>{('<a href=' + g['id'] + '.html#' + e(i['lesson']) + '>' + e(i['lesson']) + '</a>') if i['lesson'] else ''}</td><td>{e(i['page'])}</td>"
        f"<td>{e(i['msg'])}{('<br><i>Acknowledged: ' + e(i['acknowledged']) + '</i>') if i.get('acknowledged') else ''}</td></tr>"
        for g, i in flagged if i['code'] != 'textlayer-mismatch')
    tlm = sum(1 for g, i in flagged if i['code'] == 'textlayer-mismatch')
    (out_dir / 'index.html').write_text(
        f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Review · {e(cfg['label']['en'])}</title>"
        f"<style>{CSS}</style><body><header><h1>Optional review · {e(cfg['label']['en'])}</h1><a href='../'>Open the app</a></header><main>"
        "<h2>What was checked automatically</h2><ul>"
        "<li><b>Placement</b>: every lesson's week/day or chapter/day keys are read from the page's own print (tabs, bands, badges), "
        "then checked as a sequence: no missing, repeated or out-of-order days; chapter names must appear in the guide's academic plan.</li>"
        "<li><b>Structure</b>: section numbering, minutes adding up, empty sections, pages that were not transcribed.</li>"
        "<li><b>Text</b>: where the PDF has a text layer, every line was compared with it (column 'Text-layer agreement'); differences are listed per lesson.</li>"
        "<li><b>Source misprints</b> confirmed on the page image are recorded in states/&lt;state&gt;/anomalies.json and shown to teachers on that lesson.</li></ul>"
        f"<h2>Guides</h2><table><tr><th>Guide</th><th>Groups</th><th>Lessons</th><th>Errors</th><th>Warnings</th><th>Text-layer agreement</th><th>Independent placement checks (agree/total)</th><th>Human-confirmed</th></tr>{''.join(rows)}</table>"
        f"<h2>Items to look at</h2><p class=info>{tlm} smaller text differences against the PDF text layer are listed inside each guide page (mostly legacy-font decoding noise).</p>"
        f"<table><tr><th>Guide</th><th>Level</th><th>Check</th><th>Lesson</th><th>PDF page</th><th>Detail</th></tr>{flag_rows}</table>"
        "</main></body>", encoding='utf-8')
    print(f'review report: {out_dir / "index.html"}')


if __name__ == '__main__':
    main()
