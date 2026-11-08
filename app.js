'use strict';
/* Behavior Tally - logic + UI. All data stays on this device (localStorage). */

// ---------------------------------------------------------------- rules (match the Excel tracker)
const FREE = 2;      // demerits per day before a star penalty starts
const PENALTY = 1;   // stars lost per extra demerit
const STORAGE_KEY = 'behaviorTally.v1';
const DEFAULT_NAMES = ['Child 1', 'Child 2', 'Child 3', 'Child 4', 'Child 5', 'Child 6'];
const COLORS = ['#3A7BD5', '#2E8B57', '#8B5A2B', '#7B2D8B', '#C0392B', '#D68910'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_LABEL = { s: 'Star', y: 'Yellow', r: 'Red', b: 'Stars spent' };

// ---------------------------------------------------------------- pure helpers (also used by tests)
const pad = n => String(n).padStart(2, '0');
function dayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }
function mondayOf(k) { const d = parseKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime()); }
function prettyDay(k) { const d = parseKey(k); return DOW[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
function shortDate(k) { const d = parseKey(k); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
function timeLabel(ms) {
  const d = new Date(ms); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return h + ':' + pad(d.getMinutes()) + ' ' + ap;
}

const zero = () => ({ s: 0, y: 0, r: 0, b: 0 });
function buildIndex(log) {
  const idx = {};
  for (const e of log) {
    const k = dayKey(e.t);
    if (!idx[e.c]) idx[e.c] = {};
    if (!idx[e.c][k]) idx[e.c][k] = zero();
    idx[e.c][k][e.k]++;
  }
  return idx;
}
const getDay = (idx, c, k) => (idx[c] && idx[c][k]) || zero();
const gross = c => c.y + 2 * c.r;                          // Yellow + 2 x Red
const net = c => Math.max(0, gross(c) - c.b);               // after star buyback
const penalty = c => Math.max(0, net(c) - FREE) * PENALTY;  // stars lost for extra demerits

// Tablet fun-apps: lost after 2+ net demerits two days in a row, until the next clean day.
function tabletLost(idx, child, key) {
  const days = Object.keys(idx[child] || {}).sort();
  if (!days.length || key < days[0]) return false;
  let lost = false, prevNet = 0, d = days[0];
  while (d <= key) {
    const c = getDay(idx, child, d), n = net(c);
    if (n >= 2 && prevNet >= 2) lost = true;
    else if (gross(c) === 0) lost = false;
    prevNet = n; d = addDays(d, 1);
  }
  return lost;
}

// What the rules say about this child on this day. Returns [[level, text], ...]
function hintsFor(idx, child, key) {
  const c = getDay(idx, child, key), n = net(c), out = [];
  let lock = false, noLottery = false;
  for (let d = mondayOf(key); d <= key; d = addDays(d, 1)) {
    const g = gross(getDay(idx, child, d));
    if (g >= 4) lock = true;
    if (g >= 5) noLottery = true;
  }
  if (lock) out.push(['bad', 'No reading rest of week']);
  else if (n >= 2) out.push(['warn', 'No reading tonight']);
  if (noLottery) out.push(['bad', 'No movie lottery']);
  if (tabletLost(idx, child, key)) out.push(['warn', 'No tablet fun-apps']);
  const p = penalty(c);
  if (p > 0) out.push(['bad', '−' + p + ' ★ penalty']);
  return out;
}

function csvEscape(v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(rows) { return rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'; }

function dailyCsv(state, fromKey, toKey) {
  const idx = buildIndex(state.log);
  const rows = [['Date', 'Day', 'Child', 'Stars', 'Yellow', 'Red', 'Stars spent', 'Net demerits']];
  for (let d = fromKey; d <= toKey; d = addDays(d, 1)) {
    for (let c = 0; c < state.names.length; c++) {
      const x = getDay(idx, c, d);
      rows.push([d, DOW[parseKey(d).getDay()], state.names[c], x.s, x.y, x.r, x.b, net(x)]);
    }
  }
  return toCsv(rows);
}
function logCsv(state) {
  const rows = [['Date', 'Time', 'Child', 'Entry']];
  [...state.log].sort((a, b) => a.t - b.t).forEach(e => {
    rows.push([dayKey(e.t), timeLabel(e.t), state.names[e.c], TYPE_LABEL[e.k]]);
  });
  return toCsv(rows);
}

function validState(s) {
  return s && Array.isArray(s.names) && s.names.length === 6 && Array.isArray(s.log) &&
    s.log.every(e => e && Number.isFinite(e.t) && e.c >= 0 && e.c < 6 && 'syrb'.includes(e.k));
}

if (typeof module !== 'undefined') {
  module.exports = { dayKey, addDays, mondayOf, buildIndex, getDay, gross, net, penalty, tabletLost,
    hintsFor, dailyCsv, logCsv, validState, FREE, PENALTY };
}

// ================================================================ UI (browser only)
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const todayKey = () => dayKey(Date.now());

  let state = load();
  let viewKey = todayKey();
  let weekKey = mondayOf(viewKey);
  let sheetChild = null;
  let tab = 'today';
  let installEvt = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (validState(s)) return s;
    } catch (e) { /* fall through */ }
    return { names: DEFAULT_NAMES.slice(), named: false, log: [] };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save - storage is full or blocked'); }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // ---------------------------------------------------------------- logging
  function addEntry(child, kind) {
    let t = Date.now();
    if (viewKey !== todayKey()) {                       // back-filling a past day: use that day, current clock time
      const d = parseKey(viewKey), n = new Date();
      d.setHours(n.getHours(), n.getMinutes(), n.getSeconds(), 0); t = d.getTime();
    }
    state.log.push({ id: t + '-' + Math.random().toString(36).slice(2, 7), t, c: child, k: kind });
    save(); buzz(kind === 'r' ? 40 : 20);
    renderAll();
  }
  function dayEntries(child) {
    return state.log.filter(e => e.c === child && dayKey(e.t) === viewKey).sort((a, b) => a.t - b.t);
  }
  function removeEntry(id) {
    state.log = state.log.filter(e => e.id !== id); save(); renderAll();
  }
  function undoLast(child) {
    const es = dayEntries(child);
    if (!es.length) { toast('Nothing to undo'); return; }
    removeEntry(es[es.length - 1].id); toast('Undid last entry');
  }

  // ---------------------------------------------------------------- rendering
  function renderDateBar() {
    const isToday = viewKey === todayKey();
    $('dateLabel').textContent = (isToday ? 'Today · ' : '') + prettyDay(viewKey);
    $('nextDay').disabled = viewKey >= todayKey();
    $('banner').hidden = isToday;
    $('banner').innerHTML = isToday ? '' :
      'Viewing a past day – taps are logged to ' + esc(prettyDay(viewKey)) +
      ' <button id="goToday" class="linkbtn">Back to today</button>';
    if (!isToday) $('goToday').onclick = () => { viewKey = todayKey(); renderAll(); };
  }

  function renderTiles() {
    const idx = buildIndex(state.log);
    $('tiles').innerHTML = state.names.map((name, c) => {
      const x = getDay(idx, c, viewKey), g = gross(x), n = net(x);
      const hs = hintsFor(idx, c, viewKey);
      const level = g >= 5 || hs.some(h => h[0] === 'bad') ? 'bad' : n >= 2 ? 'warn' : '';
      const hintHtml = hs.length
        ? hs.map(h => '<div class="hint ' + h[0] + '">' + esc(h[1]) + '</div>').join('')
        : '<div class="hint ok">' + (g === 0 ? 'Clean so far' : 'No consequences') + '</div>';
      return '<button class="tile ' + level + '" data-c="' + c + '" style="--accent:' + COLORS[c] + '">' +
        '<div class="tname">' + esc(name) + '</div>' +
        '<div class="chips"><span class="chip s">★ ' + x.s + '</span><span class="chip y">Y ' + x.y +
        '</span><span class="chip r">R ' + x.r + '</span></div>' +
        '<div class="dem">Demerits: <b>' + n + '</b>' + (x.b ? ' <small>(' + g + ' − ' + x.b + ' spent)</small>' : '') + '</div>' +
        hintHtml + '</button>';
    }).join('');
    document.querySelectorAll('.tile').forEach(b => b.onclick = () => openSheet(+b.dataset.c));
  }

  function renderSheet() {
    if (sheetChild === null) return;
    const c = sheetChild, idx = buildIndex(state.log), x = getDay(idx, c, viewKey);
    $('sheetTitle').textContent = state.names[c];
    $('sheetDay').textContent = (viewKey === todayKey() ? 'Today' : prettyDay(viewKey));
    $('cntS').textContent = x.s; $('cntY').textContent = x.y; $('cntR').textContent = x.r;
    $('cntB').textContent = x.b;
    const hs = hintsFor(idx, c, viewKey);
    $('sheetStatus').innerHTML = '<b>Demerits: ' + net(x) + '</b>' +
      (hs.length ? ' – ' + hs.map(h => '<span class="hint ' + h[0] + '">' + esc(h[1]) + '</span>').join(' · ') : '');
    const es = dayEntries(c);
    $('entries').innerHTML = es.length ? es.map(e =>
      '<li><span class="dot ' + e.k + '"></span><span>' + TYPE_LABEL[e.k] + '</span><span class="tm">' +
      timeLabel(e.t) + '</span><button class="del" data-id="' + e.id + '" aria-label="Delete entry">×</button></li>'
    ).join('') : '<li class="empty">No entries yet</li>';
    document.querySelectorAll('.del').forEach(b => b.onclick = () => removeEntry(b.dataset.id));
  }
  function openSheet(c) { sheetChild = c; $('sheet').hidden = false; document.body.classList.add('noscroll'); renderSheet(); }
  function closeSheet() { sheetChild = null; $('sheet').hidden = true; document.body.classList.remove('noscroll'); }

  function renderWeek() {
    const idx = buildIndex(state.log);
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekKey, i));
    $('weekLabel').textContent = shortDate(days[0]) + ' – ' + shortDate(days[6]);
    $('nextWeek').disabled = addDays(weekKey, 7) > todayKey();
    let h = '<table class="wk"><thead><tr><th style="width:27%"></th>' + days.map((d, i) =>
      '<th><button class="daybtn" data-d="' + d + '">' + DOW[parseKey(d).getDay()] + '<small>' + parseKey(d).getDate() + '</small></button></th>').join('') +
      '</tr></thead><tbody>';
    const tot = [];
    state.names.forEach((name, c) => {
      const t = zero();
      h += '<tr><th class="nm" style="--accent:' + COLORS[c] + '">' + esc(name) + '</th>';
      days.forEach(d => {
        const x = getDay(idx, c, d); t.s += x.s; t.y += x.y; t.r += x.r; t.b += x.b;
        const any = x.s || x.y || x.r || x.b;
        h += '<td class="' + (net(x) >= 2 ? 'warnc' : '') + '">' + (any
          ? '<span class="ms">★' + x.s + '</span><span class="my">Y' + x.y + '</span><span class="mr">R' + x.r + '</span>'
          : '<span class="none">–</span>') + '</td>';
      });
      h += '</tr>'; tot.push(t);
    });
    $('weekTable').innerHTML = h + '</tbody></table>';
    document.querySelectorAll('.daybtn').forEach(b => b.onclick = () => { viewKey = b.dataset.d; setTab('today'); });
    $('weekTotals').innerHTML = state.names.map((name, c) => {
      const t = tot[c];
      return '<div class="trow" style="--accent:' + COLORS[c] + '"><b>' + esc(name) + '</b><span>★ ' + t.s +
        ' · Y ' + t.y + ' · R ' + t.r + (t.b ? ' · spent ' + t.b : '') + '</span></div>';
    }).join('');
  }

  function renderMore() {
    $('nameInputs').innerHTML = state.names.map((n, i) =>
      '<label>Child ' + (i + 1) + '<input type="text" data-i="' + i + '" value="' + esc(n) + '" maxlength="20" autocomplete="off"></label>').join('');
    $('installBtn').hidden = !installEvt;
  }

  function renderAll() {
    renderDateBar(); renderTiles(); renderSheet();
    if (tab === 'week') renderWeek();
  }

  function setTab(t) {
    tab = t;
    ['today', 'week', 'more'].forEach(v => {
      $('view-' + v).hidden = v !== t;
      $('tab-' + v).classList.toggle('on', v === t);
    });
    $('datebar').hidden = t !== 'today';
    if (t === 'week') { weekKey = mondayOf(viewKey); renderWeek(); }
    if (t === 'more') renderMore();
    if (t === 'today') renderAll();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- downloads / backup
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function allRange() {
    if (!state.log.length) return [todayKey(), todayKey()];
    const ks = state.log.map(e => dayKey(e.t)).sort();
    return [ks[0], ks[ks.length - 1]];
  }

  // ---------------------------------------------------------------- wiring
  function init() {
    $('prevDay').onclick = () => { viewKey = addDays(viewKey, -1); renderAll(); };
    $('nextDay').onclick = () => { if (viewKey < todayKey()) { viewKey = addDays(viewKey, 1); renderAll(); } };
    $('dateLabel').onclick = () => { viewKey = todayKey(); renderAll(); };
    ['today', 'week', 'more'].forEach(v => $('tab-' + v).onclick = () => setTab(v));

    $('btnS').onclick = () => { addEntry(sheetChild, 's'); toast(state.names[sheetChild] + '  +1 ★'); };
    $('btnY').onclick = () => { addEntry(sheetChild, 'y'); toast(state.names[sheetChild] + '  +1 Yellow'); };
    $('btnR').onclick = () => { addEntry(sheetChild, 'r'); toast(state.names[sheetChild] + '  +1 Red'); };
    $('btnB').onclick = () => {
      if (!confirm('Record 1 star spent to buy back a demerit for ' + state.names[sheetChild] + '?')) return;
      addEntry(sheetChild, 'b'); toast('1 ★ spent');
    };
    $('btnUndo').onclick = () => undoLast(sheetChild);
    $('btnDone').onclick = closeSheet;
    $('backdrop').onclick = closeSheet;

    $('prevWeek').onclick = () => { weekKey = addDays(weekKey, -7); renderWeek(); };
    $('nextWeek').onclick = () => { if (addDays(weekKey, 7) <= todayKey()) { weekKey = addDays(weekKey, 7); renderWeek(); } };

    $('saveNames').onclick = () => {
      document.querySelectorAll('#nameInputs input').forEach(i => {
        state.names[+i.dataset.i] = i.value.trim() || DEFAULT_NAMES[+i.dataset.i];
      });
      state.named = true; save(); toast('Names saved'); renderAll();
    };
    $('exportWeek').onclick = () => {
      download('tally-week-' + weekKey + '.csv', dailyCsv(state, weekKey, addDays(weekKey, 6)), 'text/csv');
    };
    $('exportAll').onclick = () => {
      const [a, b] = allRange();
      download('tally-daily-summary.csv', dailyCsv(state, a, b), 'text/csv');
    };
    $('exportLog').onclick = () => download('tally-full-log.csv', logCsv(state), 'text/csv');
    $('backup').onclick = () => download('tally-backup-' + todayKey() + '.json', JSON.stringify(state), 'application/json');
    $('restore').onchange = ev => {
      const f = ev.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const s = JSON.parse(rd.result);
          if (!validState(s)) throw new Error('bad');
          if (!confirm('Replace everything in the app with this backup (' + s.log.length + ' entries)?')) return;
          state = { names: s.names, named: true, log: s.log }; save(); renderAll(); renderMore(); toast('Backup restored');
        } catch (e) { alert('That file is not a valid backup.'); }
      };
      rd.readAsText(f); ev.target.value = '';
    };
    $('wipe').onclick = () => {
      if (confirm('Delete ALL entries? This cannot be undone. (Names are kept.)') &&
          confirm('Really delete everything? Tip: tap Backup first.')) {
        state.log = []; save(); renderAll(); toast('All entries deleted');
      }
    };
    $('installBtn').onclick = async () => {
      if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderMore();
    };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (tab === 'more') renderMore(); });

    // first run: ask for names
    if (!state.named) { $('welcome').hidden = false; renderWelcome(); }
    $('welcomeSave').onclick = () => {
      document.querySelectorAll('#welcomeInputs input').forEach(i => {
        state.names[+i.dataset.i] = i.value.trim() || DEFAULT_NAMES[+i.dataset.i];
      });
      state.named = true; save(); $('welcome').hidden = true; renderAll();
    };

    // keep "today" correct if the app stays open past midnight
    let lastToday = todayKey();
    const rollover = () => {
      const t = todayKey();
      if (t !== lastToday) { if (viewKey === lastToday) viewKey = t; lastToday = t; renderAll(); }
    };
    setInterval(rollover, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rollover(); });

    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* ignore */ }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    renderAll();
  }
  function renderWelcome() {
    $('welcomeInputs').innerHTML = state.names.map((n, i) =>
      '<label>Child ' + (i + 1) + '<input type="text" data-i="' + i + '" placeholder="Name" maxlength="20" autocomplete="off"></label>').join('');
  }
  init();
}
