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
  data.taught ||= {}; data.notes ||= {}; data.saved ||= {}; data.last ||= {};
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
  store.data.guide = GUIDE.id; store.save();
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
    const same = INDEX.guides.find((g) => g.grade === grade && g.subject === GUIDE.subject) || INDEX.guides.find((g) => g.grade === grade);
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

// ---------- views ----------
function lessonCard(l) {
  const taught = store.data.taught[l.id];
  return `<a class="lesson-card${taught ? ' taught' : ''}" href="#/lesson/${l.id}">
    <span class="kicker">${esc(unitLabel(l))}${taught ? `<span class="badge">✓ ${t('पढ़ा दिया', 'Taught')}</span>` : ''}${l.notice ? `<span class="badge warn">${t('ध्यान दें', 'Note')}</span>` : ''}</span>
    <span class="summary">${esc(summaryOf(l))}</span>
    <span class="open">${t('पाठयोजना खोलें →', 'Open lesson plan →')}</span></a>`;
}

function viewToday() {
  const pos = position();
  const lesson = pos.next || PACK.lessons[PACK.lessons.length - 1];
  const g = groupById(lesson.group);
  const pct = pos.total ? Math.round((100 * pos.taught) / pos.total) : 0;
  const saved = Object.keys(store.data.saved).filter((id) => lessonById(id));
  return `
  <section class="hero">
    <div class="kicker">${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))} · ${pos.next ? t('अगला पाठ', 'Next lesson') : t('सभी पाठ पढ़ा दिए गए', 'All lessons taught')}</div>
    <h1>${esc(whereLabel(lesson))}</h1>
    ${isNum(g.key) ? '' : `<p>${esc(g.title)}</p>`}
    <p>${esc(summaryOf(lesson))}</p>
    <a class="btn" href="#/lesson/${lesson.id}">${t('पाठयोजना खोलें →', 'Open lesson plan →')}</a>
    <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
    <div>${t(`${pos.taught} / ${pos.total} पाठ पढ़ा दिए`, `${pos.taught} of ${pos.total} lessons taught`)}</div>
  </section>
  ${pos.prev ? `<p class="muted">${t('पिछला पढ़ाया', 'Last taught')}: <a href="#/lesson/${pos.prev.id}">${esc(whereLabel(pos.prev))}</a></p>` : `<p class="muted">${t('“पढ़ा दिया है” पर चिह्न लगाने से अगला पाठ यहाँ अपने-आप आएगा।', 'Mark a lesson as taught and the next one appears here.')}</p>`}
  <div class="btn-row">
    <a class="btn secondary" href="#/year">${t('पूरा साल देखें', 'See the whole year')}</a>
    <a class="btn secondary" href="#/find">${t('पाठ खोजें', 'Find a lesson')}</a>
  </div>
  <h2>${t('मेरी सूची', 'My list')}</h2>
  ${saved.length ? `<div class="group-body">${saved.map((id) => lessonCard(lessonById(id))).join('')}</div>` : `<p class="muted">${t('किसी पाठ में “मेरी सूची में रखें” दबाएँ, वह यहाँ दिखेगा।', 'Lessons you add to My list appear here.')}</p>`}
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
        ${g.opener_page ? `<a class="linklike" href="#/page/${GUIDE.doc}/${g.opener_page}">${t('अध्याय का पहला पृष्ठ देखें', 'See the chapter opening page')}</a>` : ''}
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
  return out.join(' \n ');
}
function viewFind(q) {
  const query = (q || '').trim();
  let list = PACK.lessons;
  let hits = null;
  if (query) {
    hits = [];
    const nq = query.toLowerCase();
    for (const l of PACK.lessons) {
      const text = lessonText(l);
      const i = text.toLowerCase().indexOf(nq);
      const g = groupById(l.group);
      if (i >= 0 || whereLabel(l).includes(query) || (g.title || '').includes(query)) {
        const snip = i >= 0 ? text.slice(Math.max(0, i - 40), i + query.length + 60) : '';
        hits.push({ l, snip });
      }
    }
  }
  return `<h1>${t('सभी पाठ', 'All lessons')}</h1>
  <form class="search" role="search" onsubmit="event.preventDefault(); location.hash='#/find?q='+encodeURIComponent(this.q.value)">
    <input name="q" type="search" value="${esc(query)}" placeholder="${t('शब्द लिखें, जैसे: कविता, जोड़, मात्रा', 'Type a word')}" aria-label="${t('खोजें', 'Search')}">
    <button class="btn" type="submit">${t('खोजें', 'Search')}</button>
  </form>
  ${hits ? `<p class="muted">${t(`${hits.length} पाठ मिले`, `${hits.length} lessons found`)}</p>
    <div class="group-body">${hits.map(({ l, snip }) => `<a class="lesson-card" href="#/lesson/${l.id}"><span class="kicker">${esc(whereLabel(l))}</span>${snip ? `<span class="summary">…${highlight(snip, query)}…</span>` : `<span class="summary">${esc(summaryOf(l))}</span>`}<span class="open">${t('पाठयोजना खोलें →', 'Open lesson plan →')}</span></a>`).join('')}</div>`
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
    if (it.type === 'figure') return `<li class="figure">🖼 ${esc(it.desc || t('चित्र', 'Picture'))}${it.text ? `<br>${esc(it.text)}` : ''} <span class="muted">(${t('चित्र मूल पृष्ठ पर देखें', 'see the original page')})</span></li>`;
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
  const g = groupById(l.group);
  const i = PACK.lessons.indexOf(l);
  const prev = PACK.lessons[i - 1], next = PACK.lessons[i + 1];
  const taught = store.data.taught[l.id];
  const saved = store.data.saved[l.id];
  const chips = l.sections.map((s, k) => `<a href="#/lesson/${l.id}?s=${k}" data-jump="sec-${k}">${esc(s.number ? s.number + '. ' : '')}${esc((s.heading || t('जारी', 'Continued')).slice(0, 28))}</a>`).join('')
    + (l.shared?.length ? `<a href="#/lesson/${l.id}?s=shared" data-jump="shared">${esc((l.shared[0].heading || t('और', 'More')).slice(0, 28))}</a>` : '')
    + `<a href="#/lesson/${l.id}?s=note" data-jump="note">${t('मेरा नोट', 'My note')}</a><a href="#/lesson/${l.id}?s=pages" data-jump="pages">${t('मूल पृष्ठ', 'Original pages')}</a>`;
  const nav = `<nav class="prevnext" aria-label="${t('पाठ बदलें', 'Change lesson')}">${prev ? `<a href="#/lesson/${prev.id}">← ${esc(whereLabel(prev))}</a>` : '<span></span>'}${next ? `<a href="#/lesson/${next.id}">${esc(whereLabel(next))} →</a>` : ''}</nav>`;
  return `
  <section class="banner">
    <span class="where">${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))} · ${esc(whereLabel(l))}</span>
    <h1>${esc(isNum(g.key) ? groupLabel(g) + ' · ' + unitLabel(l) : g.title)}</h1>
    ${isNum(g.key) ? '' : `<div class="group-title">${esc(keyLabel(GUIDE.groupBy))} ${g.ordinal} · ${esc(unitLabel(l))}</div>`}
    ${l.intro?.length ? `<ul class="objectives">${l.intro.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
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
    </div></details>
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
    <div class="pages">${l.pages.map((p, k) => `<a href="#/page/${GUIDE.doc}/${p}?from=${l.id}"><img loading="lazy" src="${pageSrc(GUIDE.doc, p)}" alt="${t('पृष्ठ', 'Page')} ${esc(l.printed_pages?.[k] || p)}" width="550" height="712">${t('पृष्ठ', 'Page')} ${esc(l.printed_pages?.[k] || p)}</a>`).join('')}</div></section>
  ${nav}
  ${footer()}`;
}

function viewPage(doc, n, from) {
  const guide = INDEX.guides.find((g) => g.doc === doc) || GUIDE;
  const total = guide.pageCount;
  n = Math.max(1, Math.min(total, n));
  const q = from ? `?from=${from}` : '';
  return `<div class="viewer">
    ${from ? `<a href="#/lesson/${from}">← ${t('पाठ पर लौटें', 'Back to lesson')}</a>` : `<a href="#/guide">← ${t('मूल संदर्शिका', 'Original guide')}</a>`}
    <div class="bar">${n > 1 ? `<a class="btn secondary" href="#/page/${doc}/${n - 1}${q}">← ${t('पिछला', 'Previous')}</a>` : '<span></span>'}
      <span class="muted">PDF ${t('पृष्ठ', 'page')} ${n} / ${total}</span>
      ${n < total ? `<a class="btn secondary" href="#/page/${doc}/${n + 1}${q}">${t('अगला', 'Next')} →</a>` : '<span></span>'}</div>
    <a href="${pageSrc(doc, n)}" target="_blank" rel="noopener"><img src="${pageSrc(doc, n)}" alt="${t('संदर्शिका का मूल पृष्ठ', 'Original guide page')} ${n}"></a>
    <p class="muted">${t('चित्र पर दबाकर बड़ा करें।', 'Tap the picture to enlarge.')}</p></div>`;
}

function viewGuide() {
  return `<h1>${t('मूल संदर्शिका', 'Original guide')}</h1>
  <p class="muted">${esc(gradeOf(GUIDE))} · ${esc(subjectOf(GUIDE))}. ${t('संदर्शिका के मूल पृष्ठ, जैसे छपे हैं।', 'The guide pages as printed.')}</p>
  ${(GUIDE.sections || []).map((s) => `<a class="lesson-card" href="#/page/${GUIDE.doc}/${s.pages[0]}"><span class="kicker">PDF ${t('पृष्ठ', 'pages')} ${s.pages[0]}–${s.pages[1]}</span><span class="summary">${esc(L(s.title))}</span><span class="open">${t('पृष्ठ खोलें →', 'Open pages →')}</span></a>`).join('')}
  ${footer()}`;
}

function viewHelp() {
  const s = INDEX.state;
  return `<h1>${t('मदद', 'Help')}</h1>
  <div class="card"><h2>${t('यह ऐप क्या है', 'What this app is')}</h2>
    <p>${esc(L(s.sourceNotice))}</p>
    <p>${t('ऊपर कक्षा और विषय चुनें। “आज” पर अगला पाठ दिखता है। “पूरा साल” में हर सप्ताह/अध्याय के दिन हैं। “सभी पाठ” में शब्द से खोजें।', 'Choose class and subject at the top. Today shows the next lesson; Whole year lists every week/chapter; All lessons lets you search.')}</p></div>
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
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = (location.hash.match(/^#\/lesson\/([^?]+)/) || [])[1];
  const act = btn.dataset.act;
  if (act === 'taught') { store.data.taught[id] = new Date().toISOString().slice(0, 10); store.save(); toast(t('पढ़ा दिया — चिह्न लगा दिया', 'Marked as taught')); render({ keepScroll: true }); }
  if (act === 'untaught') { delete store.data.taught[id]; store.save(); toast(t('चिह्न हटा दिया', 'Mark removed')); render({ keepScroll: true }); }
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
      await cache.addAll(l.pages.map((p) => pageSrc(GUIDE.doc, p)));
      toast(t('यह पाठ और इसके पृष्ठ बिना इंटरनेट के खुलेंगे', 'This lesson now works offline'));
    } catch { toast(t('अभी नहीं हो पाया। इंटरनेट जाँचकर फिर कोशिश करें।', 'Could not save. Check the connection and retry.')); }
  }
});
function applyScale() { document.documentElement.style.setProperty('--text-scale', store.data.scale || 1); }

// ---------- router ----------
async function render({ keepScroll = false } = {}) {
  const hash = location.hash || '#/today';
  const [path, query] = hash.slice(1).split('?');
  const qs = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  const y = window.scrollY;
  if (parts[0] === 'lesson') {
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
    case 'page': html = viewPage(parts[1], Number(parts[2]) || 1, qs.get('from')); break;
    case 'guide': html = viewGuide(); break;
    case 'help': html = viewHelp(); break;
    default: html = viewToday();
  }
  main.innerHTML = html;
  document.documentElement.style.setProperty('--header-h', `${$('.top').offsetHeight}px`);
  const section = qs.get('s');
  if (keepScroll) window.scrollTo(0, y);
  else if (section) document.getElementById(section === 'shared' || section === 'note' || section === 'pages' ? section : `sec-${section}`)?.scrollIntoView();
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
  await useGuide(store.data.guide || INDEX.guides[0].id);
  window.addEventListener('hashchange', () => render());
  await render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
