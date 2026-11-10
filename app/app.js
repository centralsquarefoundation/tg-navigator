// Teacher-guide app — one runtime for every state. Everything state-, subject- or layout-specific
// comes from data/index.json and data/<guide>.json produced by engine/publish.py.
// Teacher data (taught marks, notes, my list) stays in this browser's localStorage only.

const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const params = new URLSearchParams(location.search);
const LANG = params.get('ui') === 'en' ? 'en' : 'hi';
const t = (hi, en) => (LANG === 'en' && en ? en : hi);
const L = (obj) => (obj ? (obj[LANG] || obj.hi || obj.en || '') : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let INDEX = null;          // data/index.json
let GUIDE = null;          // current guide meta (from INDEX.guides)
let PACK = null;           // current data/<guide>.json
const packCache = new Map();
let store = null;

// ---------- storage ----------
function loadStore() {
  const key = `tg:${INDEX.state.id}`;
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key) || '{}'); } catch { data = {}; }
  data.taught ||= {}; data.notes ||= {}; data.saved ||= {}; data.last ||= {}; data.ready ||= {};
  return {
    data,
    save() { try { localStorage.setItem(key, JSON.stringify(this.data)); } catch { toast(t('इस फ़ोन में जगह नहीं बची।', 'Storage is full.')); } },
  };
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- labels ----------
const subjectOf = (g) => L(g.subjectLabel);
const gradeOf = (g) => (g.gradeLabel ? L(g.gradeLabel) : `${t('कक्षा', 'Class')} ${g.grade}`);
const keyLabel = (name) => L(GUIDE.labels[name]) || name;
const isNum = (v) => /^\d+$/.test(String(v ?? ''));

function groupLabel(group) {
  const name = GUIDE.groupBy;
  if (isNum(group.key)) return `${keyLabel(name)} ${group.key}`;
  return `${keyLabel(name)} ${group.ordinal}: ${group.title}`;
}
function groupShort(group) { return isNum(group.key) ? `${keyLabel(GUIDE.groupBy)} ${group.key}` : group.title; }
function unitLabel(lesson) {
  return GUIDE.keys.filter((k) => k !== GUIDE.groupBy).map((k) => `${keyLabel(k)} ${lesson.keys[k] ?? '?'}`).join(' · ');
}
function whereLabel(lesson) {
  const g = groupById(lesson.group);
  return isNum(g?.key) ? `${groupShort(g)} · ${unitLabel(lesson)}` : `${keyLabel(GUIDE.groupBy)} ${g?.ordinal} · ${unitLabel(lesson)}`;
}
function summaryOf(lesson) {
  if (lesson.summary) return lesson.summary;
  if (lesson.intro?.length) return lesson.intro.slice(0, 2).join(' · ');
  const heads = [];
  for (const s of lesson.sections) for (const c of s.sections || []) if (c.heading && heads.length < 3) heads.push(c.heading);
  if (!heads.length) for (const s of lesson.sections) if (s.heading && heads.length < 3) heads.push(s.heading);
  return heads.join(' · ');
}
const groupById = (id) => PACK.groups.find((g) => g.id === id);
const lessonById = (id) => PACK.lessons.find((l) => l.id === id);
const pageSrc = (doc, n) => `pages/${doc}/p${String(n).padStart(3, '0')}.webp`;

// ---------- data loading ----------
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function useGuide(id) {
  GUIDE = INDEX.guides.find((g) => g.id === id) || INDEX.guides[0];
  if (!packCache.has(GUIDE.id)) packCache.set(GUIDE.id, await getJSON(`${GUIDE.file}?v=${INDEX.version}`));
  PACK = packCache.get(GUIDE.id);
  store.data.guide = GUIDE.id;
  (store.data.subjectFor ||= {})[GUIDE.grade] = GUIDE.id;   // back to this grade = back to this subject
  store.save();
  syncPickers();
}
function guideForLesson(lessonId) {
  return INDEX.guides.filter((g) => lessonId.startsWith(g.id + '-')).sort((a, b) => b.id.length - a.id.length)[0];
}

// ---------- header ----------
function applyBrand() {
  const b = INDEX.state.brand || {};
  for (const [k, v] of Object.entries(b.colors || {})) document.documentElement.style.setProperty(`--${k}`, v);
  const brand = $('.brand');
  const logos = (b.logos || []).map((l) => `<img src="${esc(l.src)}" alt="${esc(L(l.alt))}" width="38" height="38">`).join('');
  brand.innerHTML = `<span class="brand-logos">${logos}</span><span class="brand-name">${esc(L(INDEX.state.appTitle))}<small>${esc(L(b.department))}</small></span>`;
  document.title = L(INDEX.state.appTitle);
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-t]')) {
    const m = { today: ['आज', 'Today'], year: ['पूरा साल', 'Whole year'], find: ['सभी पाठ', 'All lessons'] }[el.dataset.t];
    if (m) el.textContent = t(...m);
  }
}
function syncPickers() {
  const gs = $('#grade-select'), ss = $('#subject-select');
  const grades = [...new Map(INDEX.guides.map((g) => [g.grade, g])).values()].sort((a, b) => a.grade - b.grade);
  gs.innerHTML = grades.map((g) => `<option value="${g.grade}"${g.grade === GUIDE.grade ? ' selected' : ''}>${esc(gradeOf(g))}</option>`).join('');
  const subjects = INDEX.guides.filter((g) => g.grade === GUIDE.grade);
  ss.innerHTML = subjects.map((g) => `<option value="${g.id}"${g.id === GUIDE.id ? ' selected' : ''}>${esc(subjectOf(g))}</option>`).join('');
}
function setupPickers() {
  $('#grade-select').addEventListener('change', async (e) => {
    const grade = Number(e.target.value);
    const last = INDEX.guides.find((g) => g.id === store.data.subjectFor?.[grade]);
    const same = last || INDEX.guides.find((g) => g.grade === grade && g.subject === GUIDE.subject) || INDEX.guides.find((g) => g.grade === grade);
    await useGuide(same.id); go(currentTab());
  });
  $('#subject-select').addEventListener('change', async (e) => { await useGuide(e.target.value); go(currentTab()); });
}
const currentTab = () => (['#/year', '#/find', '#/guide', '#/saved', '#/help'].find((r) => location.hash.startsWith(r)) || '#/today');
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

// ---------- teacher position ----------
function position() {
  const seq = PACK.lessons;
  let last = -1;
  seq.forEach((l, i) => { if (store.data.taught[l.id]) last = i; });
  return { next: seq[last + 1] || null, prev: last >= 0 ? seq[last] : null, taught: seq.filter((l) => store.data.taught[l.id]).length, total: seq.length };
}

// ---------- preparation (तैयारी) ----------
// lesson.prep = [{kind: 'material'|'book', name, where}] — names copied from the lesson's own text
const prepOf = (l, kind) => (l.prep || []).filter((p) => p.kind === kind);
function keepReady(l, max = 5) {
  const m = prepOf(l, 'material');
  if (!m.length) return '';
  const shown = m.slice(0, max).map((p) => p.name).join(', ');
  return `${shown}${m.length > max ? ` ${t(`+${m.length - max} और`, `+${m.length - max} more`)}` : ''}`;
}
function sectionIndexOf(l, where) {
  const label = (s) => [s.number, s.heading].filter(Boolean).join(' ');
  const k = l.sections.findIndex((s) => label(s) === where);
  if (k >= 0) return `sec-${k}`;
  return (l.shared || []).some((s) => label(s) === where) ? 'shared' : null;
}
function periodsLine(l) {
  // the guide's own periods with their printed minutes — the lesson at a glance
  return l.sections.filter((s) => s.heading && (s.number || s.minutes)).map((s) => `${s.number ? s.number + '. ' : ''}${s.heading}${s.minutes ? ` · ${s.minutes} ${t('मि', 'min')}` : ''}`);
}
// cut a heading at a word boundary, never mid-word
function shortLabel(s, max = 32) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).replace(/[\s(–-]+$/, '') + '…';
}
function renderPrep(l) {
  const ready = store.data.ready[l.id] || {};
  const list = (kind) => prepOf(l, kind).map((p) => {
    const key = `${kind}:${p.name}`;
    const target = sectionIndexOf(l, p.where);
    return `<li><label class="check"><input type="checkbox" data-scope="${esc(l.id)}" data-ready="${esc(key)}"${ready[key] ? ' checked' : ''}><span>${esc(p.name)}</span></label>${target ? `<a class="where-link" href="#/lesson/${l.id}?s=${target.replace('sec-', '')}" data-jump="${target}">${esc(shortLabel(p.where))} ↓</a>` : ''}</li>`;
  }).join('');
  const mats = list('material'), books = list('book');
  const periods = periodsLine(l);
  return `<section class="card prep" id="prep"><h2>${t('तैयारी', 'Preparation')}</h2>
    ${periods.length ? `<h3>${t('पाठ एक नज़र में', 'Lesson at a glance')}</h3><ol class="glance">${periods.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
    ${mats ? `<h3>${t('सामग्री (TLM) — तैयार रखें', 'Materials (TLM) to keep ready')}</h3><ul class="checklist">${mats}</ul>` : ''}
    ${books ? `<h3>${t('किताबें और पृष्ठ', 'Books and pages')}</h3><ul class="checklist">${books}</ul>` : ''}
    ${mats || books ? `<p class="muted">${t('यह सूची इसी पाठ के शब्दों से ली गई है; हर चीज़ के आगे उस हिस्से का नाम है जहाँ वह आती है। तैयार होने पर ✓ लगाएँ — यह सिर्फ़ इसी फ़ोन में रहता है।', 'Copied from this lesson’s own words; each item names the part where it is used. Tick what is ready — stays on this phone.')}</p>`
      : `<p class="muted">${t('इस पाठ के शब्दों में अलग से तैयार करने वाली कोई सामग्री नहीं मिली। पूरे निर्देश नीचे देखें।', 'No separate material is named in this lesson’s text. See the full steps below.')}</p>`}
  </section>`;
}

// the materials of a whole week/chapter in one list, each with the days that use it (weekend preparation)
function groupPrep(lesson) {
  const days = PACK.lessons.filter((l) => l.group === lesson.group);
  const norm = (s) => s.replace(/[\s‌‍\-–—‐।.,:]+/g, '').replace(/[‘’'"“”]/g, '');
  const collect = (kind) => {
    const byName = new Map();
    for (const l of days) for (const p of prepOf(l, kind)) {
      const k = norm(p.name);
      if (!byName.has(k)) byName.set(k, { name: p.name, uses: [] });
      const u = byName.get(k).uses;
      if (!u.some((x) => x.l === l)) u.push({ l, key: `${kind}:${p.name}` });
    }
    return [...byName.values()];
  };
  const mats = collect('material'), books = collect('book');
  if (!mats.length && !books.length) return '';
  const g = groupById(lesson.group);
  // one tick per item = the same tick in each day's own तैयारी list
  const isReady = (it) => it.uses.every(({ l, key }) => store.data.ready[l.id]?.[key]);
  const all = [...mats, ...books];
  const done = all.filter(isReady).length;
  const list = (items) => items.map((it) => `<li><label class="check"><input type="checkbox" data-multi="${esc(JSON.stringify(it.uses.map(({ l, key }) => [l.id, key])))}"${isReady(it) ? ' checked' : ''}><span>${esc(it.name)}</span></label>
      <span class="day-links">${it.uses.map(({ l }) => `<a href="#/lesson/${l.id}?s=prep">${esc(unitLabel(l))}</a>`).join(' ')}</span></li>`).join('');
  const what = isNum(g.key) ? t('इस सप्ताह', 'This week') : t('इस अध्याय', 'This chapter');
  return `<details class="card week-prep"${weekPrepOpen ? ' open' : ''}><summary><h2>${what} ${t('की पूरी तैयारी', '— all preparation')}</h2><span class="muted count">${t(`${all.length} चीज़ें · ${done} तैयार`, `${all.length} items · ${done} ready`)}</span></summary>
    <p class="muted">${t('सभी दिनों की सामग्री और किताबों के पृष्ठ एक साथ, ताकि पहले से जुटा सकें। हर चीज़ के आगे वे दिन हैं जिनमें वह लगेगी; यहाँ ✓ लगाने पर उन दिनों में भी लग जाता है।', 'All days’ materials and book pages together, with the days that use them; a tick here also ticks those days.')}</p>
    ${mats.length ? `<h3>${t('सामग्री (TLM)', 'Materials (TLM)')}</h3><ul class="checklist">${list(mats)}</ul>` : ''}
    ${books.length ? `<h3>${t('किताबें और पृष्ठ', 'Books and pages')}</h3><ul class="checklist">${list(books)}</ul>` : ''}</details>`;
}
let weekPrepOpen = false;

// ---------- my classes (teachers often teach several) ----------
function rememberPosition() {
  const pos = position();
  const l = pos.next;
  (store.data.classes ||= {})[GUIDE.id] = l ? { next: l.id, where: whereLabel(l), taught: pos.taught, total: pos.total } : { next: null, taught: pos.taught, total: pos.total };
  store.save();
}
// a class joins “मेरी कक्षाएँ” only when the teacher opens one of its lessons (not by passing through the menus)
function myClasses() {
  const mine = Object.entries(store.data.classes || {}).filter(([id]) => INDEX.guides.some((g) => g.id === id));
  if (mine.length < 2) return '';
  return `<nav class="class-chips" aria-label="${t('मेरी कक्षाएँ', 'My classes')}">${mine.map(([id, c]) => {
    const g = INDEX.guides.find((x) => x.id === id);
    const cur = id === GUIDE.id;
    return `<span class="class-chip${cur ? ' current' : ''}"><a href="#/today" data-guide="${esc(id)}"${cur ? ' aria-current="true"' : ''}>${esc(gradeOf(g))} · ${esc(subjectOf(g))}${store.data.offline?.[id] ? ' ✓' : ''}<small>${c.next ? esc(c.where) : t('सब पढ़ा दिया', 'All done')}</small></a>${cur ? '' : `<button data-act="forget-class" data-id="${esc(id)}" aria-label="${t('सूची से हटाएँ', 'Remove')}">✕</button>`}</span>`;
  }).join('')}</nav>`;
}

// ---------- whole-class offline ----------
function classAssets() {
  const files = new Set();
  const walk = (ss) => ss.forEach((s) => { (s.items || []).forEach((it) => it.crop && files.add(it.crop)); walk(s.sections || []); });
  for (const l of PACK.lessons) { l.pages.forEach((p) => files.add(pageSrc(l.doc || GUIDE.doc, p))); walk(l.sections); walk(l.shared || []); }
  for (const g of PACK.groups) { if (g.opener_page) files.add(pageSrc(g.doc || GUIDE.doc, g.opener_page)); walk(g.intro || []); }
  return [...files];
}
function offlineCard() {
  if (!('caches' in window)) return '';
  const saved = store.data.offline?.[GUIDE.id];
  const n = classAssets().length;
  return `<section class="card offline-card"><h2>${t('बिना इंटरनेट के लिए', 'Offline')}</h2>
    ${saved ? `<p>✓ ${t(`${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))} के सभी पाठ इस फ़ोन में रखे हैं।`, 'All lessons of this class are saved on this phone.')}</p>`
      : `<p class="muted">${t(`इस कक्षा के सभी ${PACK.lessons.length} पाठ और ${n} चित्र/पृष्ठ एक बार में रख लें (लगभग ${Math.max(1, Math.round(n * 0.09))} MB) — फिर स्कूल में बिना इंटरनेट के खुलेंगे। Wi-Fi पर करें तो अच्छा।`, `Save all ${PACK.lessons.length} lessons and ${n} pages/pictures of this class (about ${Math.max(1, Math.round(n * 0.09))} MB) to use without internet.`)}</p>`}
    <div class="btn-row"><button class="btn ${saved ? 'secondary' : ''}" data-act="offline-all">${saved ? t('फिर से अपडेट करें', 'Update again') : t('पूरी कक्षा रखें', 'Save the whole class')}</button></div>
    <div class="progress hidden" aria-hidden="true"><span style="width:0%"></span></div></section>`;
}
async function saveWholeClass(btn) {
  const card = btn.closest('.offline-card');
  const bar = card.querySelector('.progress');
  const files = [`${GUIDE.file}?v=${INDEX.version}`, ...classAssets()];
  bar.classList.remove('hidden');
  btn.disabled = true;
  try {
    try { await navigator.storage?.persist?.(); } catch {}     // ask Android not to evict the saved class
    const cache = await caches.open('tg-pages');
    let done = 0, failed = 0;
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async (f) => {
        try {
          if (!(await cache.match(f))) {
            const ctl = new AbortController(); const stall = setTimeout(() => ctl.abort(), 20000);   // a stalled request must not hang the whole save
            try { const r = await fetch(f, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); await cache.put(f, r); } finally { clearTimeout(stall); }
          }
        } catch { failed++; }
        done++;
      }));
      bar.firstElementChild.style.width = `${Math.round((100 * done) / files.length)}%`;
      btn.textContent = `${Math.round((100 * done) / files.length)}% …`;
    }
    if (failed) throw new Error(`${failed} failed`);
    (store.data.offline ||= {})[GUIDE.id] = INDEX.version; store.save();
    toast(t('पूरी कक्षा इस फ़ोन में रख ली गई', 'The whole class is saved on this phone'));
    render({ keepScroll: true });
  } catch {
    btn.disabled = false; btn.textContent = t('फिर कोशिश करें', 'Try again');
    toast(t('पूरा नहीं हो पाया। इंटरनेट जाँचकर फिर कोशिश करें — जो रखा गया वह बचा रहेगा।', 'Not finished. Check the connection and retry — what was saved stays.'));
  }
}

// ---------- share ----------
async function shareLesson(l) {
  const url = `${location.origin}${location.pathname}#/lesson/${l.id}`;
  const text = `${gradeOf(GUIDE)} · ${subjectOf(GUIDE)} · ${whereLabel(l)}`;
  if (navigator.share) { try { await navigator.share({ title: L(INDEX.state.appTitle), text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener');
}

// ---------- teach mode: one step at a time, with the printed minutes as a timer ----------
function teachSteps(l) {
  const out = [];
  l.sections.forEach((s, k) => {
    const period = [s.number, s.heading].filter(Boolean).join('. ') || t('जारी', 'Continued');
    if (s.sections?.length) {
      if (s.items?.length) out.push({ period, sec: k, step: { items: s.items, minutes: null } });
      s.sections.forEach((c) => out.push({ period, sec: k, periodMinutes: s.minutes, step: c }));
    } else out.push({ period, sec: k, step: s });
  });
  return out;
}
const minutesOf = (m) => { const x = String(m || '').match(/\d+/); return x ? Number(x[0]) : 0; };
// one timer at a time; it keeps running while the teacher moves between steps of the lesson
// state: {key, label, total(ms), end (running) | left (paused), id}
let timer = null;
let wake = null;
const fmt = (ms) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const timerLeft = () => (timer ? (timer.end ? timer.end - Date.now() : timer.left) : 0);
function stopTimer() { if (timer?.id) clearInterval(timer.id); timer = null; }
function keepAwake(on) {
  try {
    if (on && !wake) navigator.wakeLock?.request('screen').then((w) => { wake = w; w.addEventListener?.('release', () => { wake = null; }); }).catch(() => {});
    if (!on && wake) { wake.release().catch(() => {}); wake = null; }
  } catch {}
}
function paintTimer() {
  const box = document.querySelector(`.timer[data-key="${timer?.key}"]`);
  const mini = document.querySelector('.mini-clock');
  const left = timerLeft();
  if (box) {
    box.querySelector('.clock').textContent = fmt(left);
    box.querySelector('[data-act=timer]').textContent = timer.end ? t('❚❚ रोकें', '❚❚ Pause') : t('▶ जारी रखें', '▶ Resume');
  }
  if (mini) { mini.hidden = !timer || !!box; if (timer) mini.textContent = `⏱ ${timer.label}: ${fmt(left)}`; }
  if (timer?.end && left <= 0) {
    clearInterval(timer.id);
    box?.classList.add('over');
    if (box) box.querySelector('[data-act=timer]').textContent = t('▶ फिर शुरू', '▶ Start again');
    timer = null;
    if (mini) mini.hidden = true;
    try { navigator.vibrate?.([300, 150, 300]); } catch {}
    toast(t('समय पूरा हुआ', 'Time is up'));
  }
}
function viewTeach(id, n) {
  const l = lessonById(id);
  if (!l) return viewLesson(id);
  const steps = teachSteps(l);
  n = Math.max(0, Math.min(steps.length - 1, n));
  const s = steps[n];
  // the step's own printed minutes; a step without them gets its period's minutes as a block timer
  // (on the first step of that period only, so one block is timed once)
  let mins = minutesOf(s.step.minutes), label = s.step.heading || s.period, key = `${l.id}:${n}`;
  if (!mins && s.periodMinutes) {
    const first = steps.findIndex((x) => x.sec === s.sec && !minutesOf(x.step.minutes));
    if (first === n) { mins = minutesOf(s.periodMinutes); label = s.period; key = `${l.id}:p${s.sec}`; }
  }
  const head = s.step.heading || s.step.number ? `<h2>${s.step.number ? `<span class="n">${esc(s.step.number)}</span> ` : ''}${esc(s.step.heading || '')}</h2>` : '';
  const mine = timer?.key === key;
  return `<div class="teach">
    <div class="teach-top"><a class="back" href="#/lesson/${l.id}">← ${t('पूरा पाठ', 'Whole lesson')}</a><span class="muted">${t('चरण', 'Step')} ${n + 1} / ${steps.length}</span></div>
    <div class="progress"><span style="width:${Math.round((100 * (n + 1)) / steps.length)}%"></span></div>
    <div class="mini-clock" hidden></div>
    <div class="teach-period ${bandClass(s.sec)}">${esc(s.period)}${s.periodMinutes ? ` · ${esc(s.periodMinutes)} ${t('मि', 'min')}` : ''}</div>
    ${head}
    ${mins ? `<div class="timer" data-key="${esc(key)}" data-secs="${mins * 60}" data-label="${esc(label)}">
      ${key.includes(':p') ? `<span class="muted block-note">${t(`पूरे कालांश का समय (${mins} मिनट)`, `Whole period (${mins} min)`)}</span>` : ''}
      <span class="clock">${mine ? fmt(timerLeft()) : `${mins}:00`}</span>
      <button class="btn secondary" data-act="timer">${mine ? (timer.end ? t('❚❚ रोकें', '❚❚ Pause') : t('▶ जारी रखें', '▶ Resume')) : t('▶ समय शुरू', '▶ Start timer')}</button>
      <button class="btn secondary" data-act="timer-reset" aria-label="${t('घड़ी फिर से', 'Reset timer')}">↺ ${t('फिर से', 'Reset')}</button></div>` : ''}
    <div class="teach-body">${renderItems(s.step.items)}${(s.step.sections || []).map(renderStep).join('')}</div>
    <nav class="teach-nav">${n > 0 ? `<a class="btn secondary" href="#/teach/${l.id}/${n - 1}">← ${t('पिछला', 'Back')}</a>` : '<span></span>'}
      ${n < steps.length - 1 ? `<a class="btn" href="#/teach/${l.id}/${n + 1}">${t('अगला', 'Next')} →</a>`
        : `<button class="btn accent" data-act="taught-done">✓ ${t('पढ़ा दिया', 'Taught')}</button>`}</nav>
  </div>`;
}

// ---------- views ----------
function lessonCard(l, full = false) {
  const taught = store.data.taught[l.id];
  const ready = keepReady(l, 3);
  return `<a class="lesson-card${taught ? ' taught' : ''}" href="#/lesson/${l.id}">
    <span class="kicker">${esc(full ? whereLabel(l) : unitLabel(l))}${taught ? `<span class="badge">✓ ${t('पढ़ा दिया', 'Taught')}</span>` : ''}${l.notice ? `<span class="badge warn">${t('ध्यान दें', 'Note')}</span>` : ''}</span>
    <span class="summary">${esc(summaryOf(l))}</span>
    ${ready ? `<span class="ready">${t('तैयार रखें', 'Keep ready')}: ${esc(ready)}</span>` : ''}
    <span class="open">${t('पाठयोजना खोलें →', 'Open lesson plan →')}</span></a>`;
}
function weekStrip(lesson) {
  // the days of the next lesson's week/chapter: taught ones ticked, the next one outlined
  const days = PACK.lessons.filter((l) => l.group === lesson.group);
  if (days.length < 2) return '';
  const g = groupById(lesson.group);
  const title = isNum(g.key) ? `${t('यह', 'This')} ${groupShort(g)}` : `${t('यह अध्याय', 'This chapter')}: ${g.title}`;
  return `<section class="card week"><h2>${esc(title)}</h2><div class="days">${days.map((l) => {
    const done = store.data.taught[l.id];
    const next = l.id === lesson.id;
    return `<a class="day${done ? ' done' : ''}${next ? ' next' : ''}" href="#/lesson/${l.id}">${done ? '✓ ' : ''}${esc(unitLabel(l))}${next ? `<small>${t('अगला', 'next')}</small>` : ''}</a>`;
  }).join('')}</div><p class="muted">${t('✓ = पढ़ा दिया', '✓ = taught')}</p></section>`;
}

function viewToday() {
  if (store.data.classes?.[GUIDE.id]) rememberPosition();
  const pos = position();
  const lesson = pos.next || PACK.lessons[PACK.lessons.length - 1];
  const g = groupById(lesson.group);
  const pct = pos.total ? Math.round((100 * pos.taught) / pos.total) : 0;
  const saved = Object.keys(store.data.saved).filter((id) => lessonById(id));
  return `${myClasses()}
  <section class="hero">
    <div class="kicker">${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))} · ${pos.next ? t('अगला पाठ', 'Next lesson') : t('सभी पाठ पढ़ा दिए गए', 'All lessons taught')}</div>
    <h1>${esc(whereLabel(lesson))}</h1>
    ${isNum(g.key) ? '' : `<p>${esc(g.title)}</p>`}
    <p>${esc(summaryOf(lesson))}</p>
    ${prepOf(lesson, 'material').length || prepOf(lesson, 'book').length ? `<div class="hero-prep"><strong>${t('तैयारी — तैयार रखें', 'Prepare — keep ready')}:</strong>
      ${prepOf(lesson, 'material').length ? `<span>${esc(keepReady(lesson, 6))}</span>` : ''}
      ${prepOf(lesson, 'book').length ? `<span class="books">📖 ${esc(prepOf(lesson, 'book').slice(0, 3).map((p) => p.name).join(' · '))}</span>` : ''}
      <a href="#/lesson/${lesson.id}?s=prep">${t('पूरी तैयारी सूची →', 'Full preparation list →')}</a></div>` : ''}
    <a class="btn" href="#/lesson/${lesson.id}">${t('पाठयोजना खोलें →', 'Open lesson plan →')}</a>
    <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <div>${t(`${pos.taught} / ${pos.total} पाठ पढ़ा दिए`, `${pos.taught} of ${pos.total} lessons taught`)}</div>
  </section>
  ${!pos.taught ? `<p class="muted hint">${t('पहले से पढ़ा रहे हैं? “पूरा साल” में वह पाठ खोलें जहाँ आप हैं और “पाठ के विकल्प” में “यहाँ से शुरू करें” दबाएँ।', 'Already partway through? Open your current lesson from Whole year and press “Start from here” in Lesson options.')}</p>` : ''}
  ${weekStrip(lesson)}
  ${groupPrep(lesson)}
  ${offlineCard()}
  ${pos.prev ? `<p class="muted">${t('पिछला पढ़ाया', 'Last taught')}: <a href="#/lesson/${pos.prev.id}">${esc(whereLabel(pos.prev))}</a></p>` : `<p class="muted">${t('“पढ़ा दिया है” पर चिह्न लगाने से अगला पाठ यहाँ अपने-आप आएगा।', 'Mark a lesson as taught and the next one appears here.')}</p>`}
  <div class="btn-row">
    <a class="btn secondary" href="#/year">${t('पूरा साल देखें', 'See the whole year')}</a>
    <a class="btn secondary" href="#/find">${t('पाठ खोजें', 'Find a lesson')}</a>
  </div>
  <h2>${t('मेरी सूची', 'My list')}</h2>
  ${saved.length ? `<div class="group-body">${saved.map((id) => lessonCard(lessonById(id), true)).join('')}</div>` : `<p class="muted">${t('किसी पाठ में “मेरी सूची में रखें” दबाएँ, वह यहाँ दिखेगा।', 'Lessons you add to My list appear here.')}</p>`}
  <div class="btn-row"><a class="btn secondary" href="#/guide">${t('मूल संदर्शिका', 'Original guide')}</a><a class="btn secondary" href="#/help">${t('मदद', 'Help')}</a></div>
  ${footer()}`;
}

function viewYear() {
  const pos = position();
  return `<h1>${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))}</h1>
  <p class="muted">${t(`${PACK.groups.length} ${keyLabel(GUIDE.groupBy)}, ${PACK.lessons.length} पाठ योजनाएँ। किसी पर दबाकर उसके दिन देखें।`, `${PACK.groups.length} ${keyLabel(GUIDE.groupBy)}s, ${PACK.lessons.length} lesson plans. Tap one to see its days.`)}</p>
  ${PACK.groups.map((g) => {
    const ls = PACK.lessons.filter((l) => l.group === g.id);
    const done = ls.filter((l) => store.data.taught[l.id]).length;
    const open = pos.next && pos.next.group === g.id;
    return `<details class="group" id="g-${g.id}"${open ? ' open' : ''}>
      <summary><span class="num">${isNum(g.key) ? esc(g.key) : g.ordinal}</span><span class="title">${esc(isNum(g.key) ? groupLabel(g) : g.title)}</span><span class="count">${done}/${ls.length}</span></summary>
      <div class="group-body">
        ${g.opener_page ? `<a class="linklike" href="#/page/${g.doc || GUIDE.doc}/${g.opener_page}">${t('अध्याय का पहला पृष्ठ देखें', 'See the chapter opening page')}</a>` : ''}
        ${(g.intro || []).map(renderPlainSection).join('')}
        ${ls.map(lessonCard).join('')}
      </div></details>`;
  }).join('')}
  ${footer()}`;
}

function lessonText(l) {
  const out = [...(l.intro || [])];
  const walk = (ss) => ss.forEach((s) => { if (s.heading) out.push(s.heading); (s.items || []).forEach((i) => i.text && out.push(i.text)); walk(s.sections || []); });
  walk(l.sections); walk(l.shared || []);
  return out.join(' \n ').normalize('NFC');
}
function viewFind(q) {
  // NFC so a keyboard's precomposed nukta letters (e.g. U+095C ड़) match the text's ड + ़
  const query = (q || '').normalize('NFC').trim();
  let list = PACK.lessons;
  let hits = null;
  if (query) {
    hits = [];
    // spaces, hyphens and dashes are ignored on both sides: "अभ्यास पत्रक 5.3" = "अभ्यास-पत्रक 5.3" = "अभ्यासपत्रक5.3"
    const SKIP = /[\s\-–—‐‑‌‍]/;
    const squash = (s) => { let out = '', map = []; for (let k = 0; k < s.length; k++) if (!SKIP.test(s[k])) { out += s[k].toLowerCase(); map.push(k); } return { out, map }; };
    const nq = squash(query).out;
    for (const l of PACK.lessons) {
      const text = lessonText(l);
      const sq = squash(text);
      const j = nq ? sq.out.indexOf(nq) : -1;
      const g = groupById(l.group);
      if (j >= 0 || whereLabel(l).includes(query) || (g.title || '').includes(query)) {
        let snip = '', mark = '';
        if (j >= 0) {
          const a = sq.map[j], b = sq.map[j + nq.length - 1] + 1;
          mark = text.slice(a, b);
          snip = text.slice(Math.max(0, a - 40), b + 60);
        }
        hits.push({ l, snip, mark });
      }
    }
  }
  return `<h1>${t('सभी पाठ', 'All lessons')}</h1>
  <form class="search" role="search" onsubmit="event.preventDefault(); location.hash='#/find?q='+encodeURIComponent(this.q.value)">
    <input name="q" type="search" value="${esc(query)}" placeholder="${t('शब्द लिखें, जैसे: कविता, जोड़, मात्रा', 'Type a word')}" aria-label="${t('खोजें', 'Search')}">
    <button class="btn" type="submit">${t('खोजें', 'Search')}</button>
  </form>
  ${hits ? `<p class="muted">${t(`${hits.length} पाठ मिले`, `${hits.length} lessons found`)}</p>
    ${hits.length ? '' : `<p class="hint">${t('कुछ नहीं मिला। छोटा शब्द या सिर्फ़ संख्या लिखकर देखें — जैसे “5.3”, “44” या “कविता”।', 'Nothing found. Try a shorter word or just a number, e.g. “5.3”, “44”.')}</p>`}
    <div class="group-body">${hits.map(({ l, snip, mark }) => `<a class="lesson-card" href="#/lesson/${l.id}"><span class="kicker">${esc(whereLabel(l))}</span>${snip ? `<span class="summary">…${highlight(snip, mark)}…</span>` : `<span class="summary">${esc(summaryOf(l))}</span>`}<span class="open">${t('पाठयोजना खोलें →', 'Open lesson plan →')}</span></a>`).join('')}</div>`
    : PACK.groups.map((g) => `<h2>${esc(groupLabel(g))}</h2><div class="group-body">${list.filter((l) => l.group === g.id).map(lessonCard).join('')}</div>`).join('')}
  ${footer()}`;
}
function highlight(s, q) {
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
}

const bandClass = (i) => `b${(i % 5) + 1}`;
function renderItems(items) {
  if (!items?.length) return '';
  return `<ul class="items">${items.map((it) => {
    if (it.type === 'table') return `<li class="tbl"><table>${(it.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></li>`;
    if (it.type === 'figure' && it.crop) return `<li class="figure has-crop"><a href="${esc(it.crop)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(it.crop)}" alt="${esc(LANG === 'en' && it.desc ? it.desc : t('गतिविधि का चित्र', 'Activity picture'))}"></a>${it.text ? `<span class="caption">${esc(it.text)}</span>` : ''}</li>`;
    // no crop: say where the picture is; the transcriber's description is English and only shown in the English UI
    if (it.type === 'figure') return `<li class="figure">🖼 ${t('यहाँ एक चित्र है — मूल पृष्ठ पर देखें', 'A picture is printed here — see the original page')}${it.text ? `<br>${esc(it.text)}` : ''}${LANG === 'en' && it.desc ? ` <span class="muted">(${esc(it.desc)})</span>` : ''}</li>`;
    return `<li class="${it.type === 'text' ? 'text' : ''}">${esc(it.text)}</li>`;
  }).join('')}</ul>`;
}
function renderStep(s) {
  const head = s.heading || s.number ? `<h3>${s.number ? `<span class="n">${esc(s.number)}</span>` : ''}<span>${esc(s.heading || '')}</span>${s.minutes ? `<span class="min">⏱ ${esc(s.minutes)} ${t('मिनट', 'min')}</span>` : ''}</h3>` : '';
  return `<div class="step">${head}${renderItems(s.items)}${(s.sections || []).map(renderStep).join('')}</div>`;
}
function renderSection(s, i, idPrefix) {
  const hasHead = s.heading || s.number;
  return `<section class="section ${bandClass(i)}" id="${idPrefix}${i}">
    ${hasHead ? `<header>${s.number ? `<span class="n">${esc(s.number)}.</span>` : ''}<h2>${esc(s.heading || '')}</h2>${s.minutes ? `<span class="min">⏱ ${esc(s.minutes)} ${t('मिनट', 'min')}</span>` : ''}</header>` : `<header><h2>${t('पिछले पृष्ठ से जारी', 'Continued')}</h2></header>`}
    <div class="section-body">${renderItems(s.items)}${(s.sections || []).map(renderStep).join('')}</div></section>`;
}
function renderPlainSection(s) {
  return `<div class="step">${s.heading ? `<h3>${esc(s.heading)}</h3>` : ''}${renderItems(s.items)}${(s.sections || []).map(renderStep).join('')}</div>`;
}

function viewLesson(id) {
  const l = lessonById(id);
  if (!l) return `<h1>${t('पाठ नहीं मिला', 'Lesson not found')}</h1><a href="#/today">${t('आज पर लौटें', 'Back to Today')}</a>`;
  store.data.last[GUIDE.id] = l.id; store.save();
  rememberPosition();
  const g = groupById(l.group);
  const i = PACK.lessons.indexOf(l);
  const prev = PACK.lessons[i - 1], next = PACK.lessons[i + 1];
  const taught = store.data.taught[l.id];
  const saved = store.data.saved[l.id];
  const chips = `<a href="#/lesson/${l.id}?s=prep" data-jump="prep">${t('तैयारी', 'Preparation')}</a>` + l.sections.map((s, k) => `<a href="#/lesson/${l.id}?s=${k}" data-jump="sec-${k}">${esc(s.number ? s.number + '. ' : '')}${esc((s.heading || t('जारी', 'Continued')).slice(0, 28))}</a>`).join('')
    + (l.shared?.length ? `<a href="#/lesson/${l.id}?s=shared" data-jump="shared">${esc((l.shared[0].heading || t('और', 'More')).slice(0, 28))}</a>` : '')
    + `<a href="#/lesson/${l.id}?s=note" data-jump="note">${t('मेरा नोट', 'My note')}</a><a href="#/lesson/${l.id}?s=pages" data-jump="pages">${t('मूल पृष्ठ', 'Original pages')}</a>`;
  const nav = `<nav class="prevnext" aria-label="${t('पाठ बदलें', 'Change lesson')}">${prev ? `<a href="#/lesson/${prev.id}">← ${esc(whereLabel(prev))}</a>` : '<span></span>'}${next ? `<a href="#/lesson/${next.id}">${esc(whereLabel(next))} →</a>` : ''}</nav>`;
  return `
  <section class="banner">
    <span class="where">${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))} · ${esc(whereLabel(l))}</span>
    <h1>${esc(isNum(g.key) ? groupLabel(g) + ' · ' + unitLabel(l) : g.title)}</h1>
    ${isNum(g.key) ? '' : `<div class="group-title">${esc(keyLabel(GUIDE.groupBy))} ${g.ordinal} · ${esc(unitLabel(l))}</div>`}
    ${l.intro?.length ? `<ul class="objectives">${l.intro.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="btn-row banner-actions"><a class="btn accent" href="#/teach/${l.id}/0">▶ ${t('कक्षा में पढ़ाएँ (एक-एक चरण)', 'Teach step by step')}</a>
      <button class="btn secondary" data-act="share">${t('साझा करें', 'Share')}</button></div>
  </section>
  ${nav}
  ${l.notice ? `<div class="notice">${esc(L(l.notice))}</div>` : ''}
  <nav class="chips" aria-label="${t('पाठ के हिस्से', 'Lesson parts')}">${chips}</nav>
  <details class="options card"><summary>${t('पाठ के विकल्प', 'Lesson options')}</summary>
    <div class="btn-row">
      <button class="btn secondary" data-act="save">${saved ? t('मेरी सूची से हटाएँ', 'Remove from My list') : t('मेरी सूची में रखें', 'Add to My list')}</button>
      <button class="btn secondary" data-act="offline">${t('बिना इंटरनेट के लिए रखें', 'Keep for offline use')}</button>
      <button class="btn secondary" data-act="bigger">${t('अक्षर बड़े करें', 'Larger text')}</button>
      <button class="btn secondary" data-act="smaller">${t('अक्षर छोटे करें', 'Smaller text')}</button>
      ${i > 0 ? `<button class="btn secondary" data-act="start-here">${t('यहाँ से शुरू करें', 'Start from here')}</button>` : ''}
    </div>${i > 0 ? `<p class="muted">${t('“यहाँ से शुरू करें”: इससे पहले के सभी पाठों पर “पढ़ा दिया” का चिह्न लग जाएगा, ताकि “आज” पर यही पाठ आए।', '“Start from here” marks all earlier lessons as taught, so Today shows this lesson.')}</p>` : ''}</details>
  ${renderPrep(l)}
  ${l.sections.map((s, k) => renderSection(s, k, 'sec-')).join('')}
  ${l.shared?.length ? `<div class="shared" id="shared">${l.shared.map((s, k) => renderSection(s, 9 + k, 'shared-')).join('')}</div>` : ''}
  <section class="card" id="note"><h2>${t('मेरा नोट', 'My note')}</h2>
    <label class="sr" for="note-text">${t('मेरा नोट', 'My note')}</label>
    <textarea id="note-text" placeholder="${t('इस पाठ के लिए अपनी बात लिखें। यह सिर्फ़ इसी फ़ोन में रहेगी।', 'Your note stays on this phone only.')}">${esc(store.data.notes[l.id] || '')}</textarea>
    <div class="btn-row"><button class="btn secondary" data-act="note">${t('नोट सहेजें', 'Save note')}</button></div></section>
  <section class="card">
    <div class="btn-row">${taught
      ? `<button class="btn done" data-act="untaught">✓ ${t('पढ़ा दिया है', 'Taught')} · ${t('चिह्न हटाएँ', 'Undo')}</button>`
      : `<button class="btn accent" data-act="taught">${t('पढ़ा दिया है · चिह्न लगाएँ', 'Taught · mark it')}</button>`}</div>
    <p class="muted">${t('सिर्फ़ पढ़ने से पाठ “पढ़ा दिया” नहीं माना जाता।', 'Reading a lesson never marks it taught.')}</p></section>
  <section class="card" id="pages"><h2>${t('मूल पृष्ठ', 'Original pages')}</h2>
    <p class="muted">${t('यह पाठ संदर्शिका के इन पृष्ठों से लिया गया है। मूल से मिलाने के लिए पृष्ठ खोलें।', 'This lesson comes from these guide pages. Open a page to compare with the original.')}</p>
    <div class="pages">${l.pages.map((p, k) => `<a href="#/page/${l.doc || GUIDE.doc}/${p}?from=${l.id}"><img loading="lazy" src="${pageSrc(l.doc || GUIDE.doc, p)}" alt="${t('पृष्ठ', 'Page')} ${esc(l.printed_pages?.[k] || p)}" width="550" height="712">${t('पृष्ठ', 'Page')} ${esc(l.printed_pages?.[k] || p)}</a>`).join('')}</div></section>
  ${nav}
  ${footer()}`;
}

function viewPage(doc, n, from) {
  const guide = INDEX.guides.find((g) => g.pageCounts && doc in g.pageCounts) || GUIDE;
  const total = guide.pageCounts?.[doc] || 1;
  n = Math.max(1, Math.min(total, n));
  const q = from ? `?from=${from}` : '';
  return `<div class="viewer">
    ${from ? `<a class="back" href="#/lesson/${from}">← ${t('पाठ पर लौटें', 'Back to lesson')}</a>` : `<a class="back" href="#/guide">← ${t('मूल संदर्शिका', 'Original guide')}</a>`}
    <div class="bar">${n > 1 ? `<a class="btn secondary" href="#/page/${doc}/${n - 1}${q}">← ${t('पिछला', 'Previous')}</a>` : '<span></span>'}
      <span class="muted">${t('PDF पृष्ठ', 'PDF page')} ${n} / ${total}</span>
      ${n < total ? `<a class="btn secondary" href="#/page/${doc}/${n + 1}${q}">${t('अगला', 'Next')} →</a>` : '<span></span>'}</div>
    <a href="${pageSrc(doc, n)}" target="_blank" rel="noopener"><img src="${pageSrc(doc, n)}" alt="${t('संदर्शिका का मूल पृष्ठ', 'Original guide page')} ${n}"></a>
    <p class="muted">${t('चित्र पर दबाकर बड़ा करें।', 'Tap the picture to enlarge.')}</p></div>`;
}

function viewGuide() {
  return `<h1>${t('मूल संदर्शिका', 'Original guide')}</h1>
  <p class="muted">${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))}. ${t('संदर्शिका के मूल पृष्ठ, जैसे छपे हैं।', 'The guide pages as printed.')}</p>
  ${(GUIDE.sections || []).map((s) => `<a class="lesson-card" href="#/page/${s.doc || GUIDE.doc}/${s.pages[0]}"><span class="kicker">PDF ${t('पृष्ठ', 'pages')} ${s.pages[0]}–${s.pages[1]}</span><span class="summary">${esc(L(s.title))}</span><span class="open">${t('पृष्ठ खोलें →', 'Open pages →')}</span></a>`).join('')}
  ${footer()}`;
}

function viewHelp() {
  const s = INDEX.state;
  return `<h1>${t('मदद', 'Help')}</h1>
  <div class="card"><h2>${t('यह ऐप क्या है', 'What this app is')}</h2>
    <p>${esc(L(s.sourceNotice))}</p>
    <p>${t('ऊपर कक्षा और विषय चुनें। “आज” पर अगला पाठ दिखता है। “पूरा साल” में हर सप्ताह/अध्याय के दिन हैं। “सभी पाठ” में शब्द से खोजें।', 'Choose class and subject at the top. Today shows the next lesson; Whole year lists every week/chapter; All lessons lets you search.')}</p>
    <p>${t('हर पाठ में सबसे ऊपर “तैयारी” है: पाठ एक नज़र में, तैयार रखने वाली सामग्री (TLM) और किताबों के पृष्ठ। यह सूची पाठ के अपने शब्दों से ली गई है। “आज” पर अगले पाठ की तैयारी भी दिखती है, ताकि एक दिन पहले सामग्री जुटा सकें।', 'Each lesson starts with “Preparation”: the lesson at a glance, the materials (TLM) to keep ready and the book pages, copied from the lesson’s own words. Today also shows the next lesson’s preparation so you can gather materials the day before.')}</p>
    <p>${t('“कक्षा में पढ़ाएँ” से पाठ एक-एक चरण में बड़े अक्षरों में खुलता है; जिस चरण के मिनट छपे हैं उसमें समय गिनने वाली घड़ी भी है। “आज” पर पूरे सप्ताह की सामग्री, आपकी दूसरी कक्षाएँ और “पूरी कक्षा रखें” (बिना इंटरनेट के लिए) भी हैं। “साझा करें” से पाठ का लिंक WhatsApp पर भेज सकते हैं।', '“Teach step by step” opens the lesson one step at a time in large text, with a timer where minutes are printed. Today also lists the whole week’s materials, your other classes and “Save the whole class” for offline use. “Share” sends the lesson link, e.g. on WhatsApp.')}</p></div>
  <div class="card"><h2>${t('आपका डेटा', 'Your data')}</h2>
    <p>${t('“पढ़ा दिया है” के चिह्न, नोट और मेरी सूची सिर्फ़ इसी फ़ोन के ब्राउज़र में रहते हैं। ये कहीं भेजे नहीं जाते। ब्राउज़र का डेटा मिटाने पर ये भी मिट जाएँगे।', 'Taught marks, notes and My list stay only in this phone’s browser. Nothing is sent anywhere. Clearing browser data removes them.')}</p></div>
  <div class="card"><h2>${t('पाठ कैसे बनाए गए', 'How lessons were made')}</h2>
    <p>${t('पाठ संदर्शिका के मूल पृष्ठों से पढ़कर बनाए गए हैं और उनका क्रम (सप्ताह, दिवस, अध्याय) स्वतः जाँचा गया है। हर पाठ के नीचे उसके मूल पृष्ठ हैं। कोई अंतर दिखे तो मूल पृष्ठ को सही मानें। इनकी शैक्षणिक समीक्षा अलग से नहीं हुई है।', 'Lessons were read from the original pages and their order (week, day, chapter) was checked automatically. Each lesson shows its original pages: if anything differs, the original page is right. No separate academic review has been done.')}</p>
    <p class="muted">${t('सामग्री संस्करण', 'Content version')}: ${esc(INDEX.version)}</p></div>
  ${footer()}`;
}

function footer() {
  const b = INDEX.state.brand || {};
  return `<footer class="foot">${(b.footerLogos || []).map((l) => `<img src="${esc(l.src)}" alt="${esc(L(l.alt))}">`).join('')}
    <span>${esc(L(INDEX.state.appTitle))} · ${esc(INDEX.state.edition || '')}</span></footer>`;
}

// ---------- actions ----------
main.addEventListener('click', async (e) => {
  const jump = e.target.closest('[data-jump]');
  if (jump) { e.preventDefault(); document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const other = e.target.closest('[data-guide]');
  if (other && other.dataset.guide !== GUIDE.id) { e.preventDefault(); await useGuide(other.dataset.guide); location.hash = other.getAttribute('href'); render(); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = (location.hash.match(/^#\/(?:lesson|teach)\/([^?/]+)/) || [])[1];
  const act = btn.dataset.act;
  if (act === 'taught') { store.data.taught[id] = new Date().toISOString().slice(0, 10); store.save(); rememberPosition(); toast(t('पढ़ा दिया — चिह्न लगा दिया', 'Marked as taught')); render({ keepScroll: true }); }
  if (act === 'untaught') { delete store.data.taught[id]; store.save(); rememberPosition(); toast(t('चिह्न हटा दिया', 'Mark removed')); render({ keepScroll: true }); }
  if (act === 'share') shareLesson(lessonById(id));
  if (act === 'offline-all') saveWholeClass(btn);
  if (act === 'timer' || act === 'timer-reset') {
    const el = btn.closest('.timer');
    const key = el.dataset.key;
    el.classList.remove('over');
    if (act === 'timer-reset') {
      if (timer?.key === key) stopTimer();
      el.querySelector('.clock').textContent = `${Math.floor(Number(el.dataset.secs) / 60)}:00`;
      el.querySelector('[data-act=timer]').textContent = t('▶ समय शुरू', '▶ Start timer');
    } else if (timer?.key === key && timer.end) {          // pause
      clearInterval(timer.id); timer = { ...timer, left: timer.end - Date.now(), end: null, id: null }; paintTimer();
    } else {                                                // start, resume, or replace another step's timer
      const left = timer?.key === key ? timer.left : Number(el.dataset.secs) * 1000;
      stopTimer();
      timer = { key, label: el.dataset.label, end: Date.now() + left, id: setInterval(paintTimer, 500) };
      paintTimer();
    }
  }
  if (act === 'taught-done') {
    store.data.taught[id] = new Date().toISOString().slice(0, 10); store.save(); rememberPosition();
    toast(t('पढ़ा दिया — चिह्न लगा दिया', 'Marked as taught'));
    location.hash = '#/today';
  }
  if (act === 'forget-class') { delete store.data.classes[btn.dataset.id]; store.save(); render({ keepScroll: true }); }
  if (act === 'start-here') {
    const i = PACK.lessons.findIndex((l) => l.id === id);
    if (i > 0 && confirm(t(`इससे पहले के ${i} पाठों पर “पढ़ा दिया” का चिह्न लगेगा। ठीक है?`, `Mark the ${i} earlier lessons as taught?`))) {
      PACK.lessons.slice(0, i).forEach((l) => { store.data.taught[l.id] ||= 'start'; });
      store.save(); rememberPosition();
      toast(t('ठीक है — “आज” पर अब यही पाठ है', 'Done — Today now shows this lesson'));
      render({ keepScroll: true });
    }
  }
  if (act === 'save') { if (store.data.saved[id]) delete store.data.saved[id]; else store.data.saved[id] = 1; store.save(); toast(store.data.saved[id] ? t('मेरी सूची में रखा', 'Added to My list') : t('मेरी सूची से हटाया', 'Removed from My list')); render({ keepScroll: true }); }
  if (act === 'note') { store.data.notes[id] = $('#note-text').value; store.save(); toast(t('नोट सहेज लिया', 'Note saved')); }
  if (act === 'bigger' || act === 'smaller') {
    const s = Math.max(0.9, Math.min(2, (store.data.scale || 1) + (act === 'bigger' ? 0.15 : -0.15)));
    store.data.scale = Math.round(s * 100) / 100; store.save(); applyScale();
  }
  if (act === 'offline') {
    const l = lessonById(id);
    try {
      const cache = await caches.open('tg-pages');
      // the lesson's pages and its picture crops (crops load lazily, so they may not be cached yet)
      const crops = [];
      const walk = (ss) => ss.forEach((s) => { (s.items || []).forEach((it) => it.crop && crops.push(it.crop)); walk(s.sections || []); });
      walk(l.sections); walk(l.shared || []);
      await cache.addAll([...new Set([...l.pages.map((p) => pageSrc(l.doc || GUIDE.doc, p)), ...crops])]);
      toast(t('यह पाठ और इसके पृष्ठ बिना इंटरनेट के खुलेंगे', 'This lesson now works offline'));
    } catch { toast(t('अभी नहीं हो पाया। इंटरनेट जाँचकर फिर कोशिश करें।', 'Could not save. Check the connection and retry.')); }
  }
});
main.addEventListener('toggle', (e) => { if (e.target.classList?.contains('week-prep')) weekPrepOpen = e.target.open; }, true);
// preparation checklist ticks (per lesson, this phone only)
main.addEventListener('change', (e) => {
  if (e.target.dataset?.multi) {
    for (const [id, key] of JSON.parse(e.target.dataset.multi)) {
      const r = (store.data.ready[id] ||= {});
      if (e.target.checked) r[key] = 1; else delete r[key];
      if (!Object.keys(r).length) delete store.data.ready[id];
    }
    store.save(); weekPrepOpen = true; render({ keepScroll: true });
    return;
  }
  const key = e.target.dataset?.ready;
  if (!key) return;
  const id = e.target.dataset.scope;
  if (!id) return;
  const r = (store.data.ready[id] ||= {});
  if (e.target.checked) r[key] = 1; else delete r[key];
  if (!Object.keys(r).length) delete store.data.ready[id];
  store.save();
});
// a typed note is kept even if the teacher leaves without pressing “नोट सहेजें”
main.addEventListener('input', (e) => {
  if (e.target.id !== 'note-text') return;
  const id = (location.hash.match(/^#\/lesson\/([^?]+)/) || [])[1];
  if (!id) return;
  if (e.target.value) store.data.notes[id] = e.target.value; else delete store.data.notes[id];
  store.save();
});
function applyScale() { document.documentElement.style.setProperty('--text-scale', store.data.scale || 1); }
// अ− / अ+ in the header: works on every screen
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-size]');
  if (!b) return;
  const s = Math.max(0.9, Math.min(2, (store.data.scale || 1) + 0.15 * Number(b.dataset.size)));
  store.data.scale = Math.round(s * 100) / 100; store.save(); applyScale();
  toast(`${t('अक्षर का आकार', 'Text size')}: ${Math.round(store.data.scale * 100)}%`);
});

// ---------- router ----------
async function render({ keepScroll = false } = {}) {
  const hash = location.hash || '#/today';
  const [path, query] = hash.slice(1).split('?');
  const qs = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  const y = window.scrollY;
  // the timer survives moving between steps of the same lesson; leaving teach mode stops it
  if (parts[0] !== 'teach' || (timer && !timer.key.startsWith(parts[1] + ':'))) stopTimer();
  document.body.classList.toggle('teach-mode', parts[0] === 'teach');
  keepAwake(parts[0] === 'teach');      // the screen stays on for the whole of teach mode
  if (parts[0] === 'lesson' || parts[0] === 'teach') {
    const g = guideForLesson(parts[1]);
    if (g && g.id !== GUIDE.id) await useGuide(g.id);
  }
  for (const a of document.querySelectorAll('.tabs a')) a.removeAttribute('aria-current');
  const tab = { today: '#today-link', year: '#year-link', find: '#find-link' }[parts[0] || 'today'];
  if (tab) $(tab).setAttribute('aria-current', 'page');
  let html;
  switch (parts[0]) {
    case 'year': html = viewYear(); break;
    case 'find': html = viewFind(qs.get('q')); break;
    case 'lesson': html = viewLesson(parts[1]); break;
    case 'teach': html = viewTeach(parts[1], Number(parts[2]) || 0); break;
    case 'page': html = viewPage(parts[1], Number(parts[2]) || 1, qs.get('from')); break;
    case 'guide': html = viewGuide(); break;
    case 'help': html = viewHelp(); break;
    default: html = viewToday();
  }
  main.innerHTML = html;
  if (parts[0] === 'teach') paintTimer();
  // logos + pickers scroll away; the tab bar stays pinned
  const brandH = $('.brand-row').offsetHeight;
  $('.top').style.top = `-${brandH}px`;
  document.documentElement.style.setProperty('--header-h', `${$('.top').offsetHeight - brandH}px`);
  const section = qs.get('s');
  if (keepScroll) window.scrollTo(0, y);
  else if (section) document.getElementById(['shared', 'note', 'pages', 'prep'].includes(section) ? section : `sec-${section}`)?.scrollIntoView();
  else window.scrollTo(0, 0);
  if (!keepScroll && parts[0] === 'year') document.querySelector('details.group[open]')?.scrollIntoView({ block: 'start' });
}

async function start() {
  try {
    INDEX = await getJSON('data/index.json');
  } catch {
    main.innerHTML = `<p>${t('ऐप खुल नहीं पाया। इंटरनेट जाँचकर पेज फिर खोलें।', 'The app could not load. Check the connection and reload.')}</p>`;
    return;
  }
  store = loadStore();
  applyBrand(); applyScale(); setupPickers();
  // a deep link to a lesson opens that lesson's guide directly (no download of the last-used guide first)
  const linked = (location.hash.match(/^#\/(?:lesson|teach)\/([^?/]+)/) || [])[1];
  await useGuide((linked && guideForLesson(linked)?.id) || store.data.guide || INDEX.guides[0].id);
  window.addEventListener('hashchange', () => render());
  await render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
