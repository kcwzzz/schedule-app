'use strict';

(function () {
  const STORE_KEY = 'schedule-app:v1';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const WEEK_START = 0; // 0 = 일요일 시작
  const MONTH_PREVIEW_LIMIT = 3; // 월간 칸 하나에 보여줄 최대 항목 수
  const DEFAULT_CATEGORIES = [
    { id: 'work', name: '업무', color: '#3b82f6' },
    { id: 'personal', name: '개인', color: '#10b981' },
    { id: 'health', name: '건강', color: '#f59e0b' },
    { id: 'etc', name: '기타', color: '#a855f7' },
  ];

  // ---------- 저장소 ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.items)) return normalizeDb(data);
      }
    } catch (e) { /* 손상된 데이터는 무시하고 새로 시작 */ }
    return normalizeDb({ items: [] });
  }

  // goals: [{ id, period: 'week'|'month', key: '2026-10-04'|'2026-10', title, done, subtasks: [{ id, title, done }] }]
  function normalizeDb(data) {
    return {
      items: data.items,
      categories: Array.isArray(data.categories) && data.categories.length ? data.categories : DEFAULT_CATEGORIES.slice(),
      goals: Array.isArray(data.goals) ? data.goals : [],
    };
  }

  let db = load();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (e) {
      alert('저장에 실패했어요. 저장 공간을 확인해주세요.');
    }
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- 날짜 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfWeek = (d) => addDays(d, -((d.getDay() - WEEK_START + 7) % 7));
  const todayStr = () => ymd(new Date());
  const fmtMonthDay = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

  // ---------- 항목 ----------
  function categoryOf(item) {
    return db.categories.find((c) => c.id === item.categoryId) || null;
  }

  function colorOf(item) {
    const c = categoryOf(item);
    return c ? c.color : '#8e8e93';
  }

  // 미완료 → 완료 순, 그 안에서 종일 → 시간순
  function compareItems(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.start || '').localeCompare(b.start || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
  }

  function groupByDate() {
    const map = new Map();
    for (const it of db.items) {
      if (!it.date) continue;
      if (!map.has(it.date)) map.set(it.date, []);
      map.get(it.date).push(it);
    }
    for (const list of map.values()) list.sort(compareItems);
    return map;
  }

  function itemsOn(ds) {
    return db.items.filter((i) => i.date === ds).sort(compareItems);
  }

  function upsert(data) {
    const now = new Date().toISOString();
    const derived = { kind: data.start ? 'event' : 'task', allDay: !data.start, updatedAt: now };
    const existing = data.id && db.items.find((i) => i.id === data.id);
    if (existing) {
      Object.assign(existing, data, derived);
    } else {
      db.items.push(Object.assign({ done: false, createdAt: now }, data, derived, { id: uid() }));
    }
    save();
  }

  function removeItem(id) {
    db.items = db.items.filter((i) => i.id !== id);
    save();
  }

  function toggleDone(id) {
    const it = db.items.find((i) => i.id === id);
    if (!it) return;
    it.done = !it.done;
    it.doneAt = it.done ? new Date().toISOString() : undefined;
    it.updatedAt = new Date().toISOString();
    save();
  }

  function timeLabel(it) {
    if (!it.start) return '종일';
    return it.end ? `${it.start} – ${it.end}` : it.start;
  }

  // "14:00 치과", "3시 치과", "오후 3시 반 미팅" → 시간 + 제목
  function parseQuick(text) {
    const t = text.trim();
    const m = t.match(/^(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(반|\d{1,2}분))?)\s+(.+)$/);
    if (!m) return { title: t, start: '' };
    let h = Number(m[2]);
    const min = m[3] ? Number(m[3]) : m[4] === '반' ? 30 : m[4] ? parseInt(m[4], 10) : 0;
    if (m[1] === '오후' && h < 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
    if (h > 23 || min > 59) return { title: t, start: '' };
    return { title: m[5].trim(), start: `${pad(h)}:${pad(min)}` };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 라우팅 ----------
  // #/month/2026-10 · #/week/2026-10-04 · #/day/2026-10-09
  const monthHash = (d) => `#/month/${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const weekHash = (d) => `#/week/${ymd(startOfWeek(d))}`;
  const dayHash = (d) => `#/day/${ymd(d)}`;
  // #/goals/week/2026-10-04 · #/goals/month/2026-10
  const goalsHash = (period, d) => `#/goals/${period}/${period === 'week' ? ymd(startOfWeek(d)) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`}`;

  function parseRoute() {
    const [view, arg = '', arg2 = ''] = location.hash.replace(/^#\/?/, '').split('/');
    if (view === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return { view: 'day', date: parseYmd(arg) };
    if (view === 'goals' && arg === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(arg2)) return { view: 'goals', period: 'week', date: startOfWeek(parseYmd(arg2)) };
    if (view === 'goals' && arg === 'month' && /^\d{4}-\d{2}$/.test(arg2)) {
      const [y, m] = arg2.split('-').map(Number);
      return { view: 'goals', period: 'month', date: new Date(y, m - 1, 1) };
    }
    if (view === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return { view: 'week', date: startOfWeek(parseYmd(arg)) };
    if (view === 'month' && /^\d{4}-\d{2}$/.test(arg)) {
      const [y, m] = arg.split('-').map(Number);
      return { view: 'month', date: new Date(y, m - 1, 1) };
    }
    const t = new Date();
    return { view: 'month', date: new Date(t.getFullYear(), t.getMonth(), 1) };
  }

  const scrollMemo = {}; // 목록 화면별 스크롤 위치 (상세에서 돌아올 때 복원)
  let returnHash = null; // 상세 페이지로 들어오기 전 목록 화면
  let goalsReturn = null; // 목표 화면으로 들어오기 전 달력 화면

  function go(hash) {
    if (location.hash === hash) render({ scroll: 'today' });
    else location.hash = hash;
  }

  // ---------- 렌더링 ----------
  const app = document.getElementById('app');
  const sheetRoot = document.getElementById('sheet-root');

  function render(opts = {}) {
    const r = parseRoute();
    const y = window.scrollY;
    app.innerHTML = r.view === 'day' ? renderDay(r.date) : r.view === 'goals' ? renderGoals(r.period, r.date) : renderList(r.view, r.date);
    app.className = `view-${r.view}`;
    document.title = r.view === 'day' ? `${fmtMonthDay(r.date)} · 일정` : r.view === 'goals' ? '목표 · 일정' : '일정';

    const scroll = opts.scroll || 'today';
    if (scroll === 'keep') {
      window.scrollTo(0, y);
    } else if (r.view !== 'day' && scroll === 'memo' && scrollMemo[location.hash] != null) {
      window.scrollTo(0, scrollMemo[location.hash]);
    } else {
      window.scrollTo(0, 0);
    }
  }

  function renderList(mode, anchor) {
    const today = todayStr();
    const map = groupByDate();
    let title, sub, body;

    if (mode === 'month') {
      const y = anchor.getFullYear();
      const m = anchor.getMonth();
      const lead = (anchor.getDay() - WEEK_START + 7) % 7; // 1일 앞의 빈 칸 수
      const weeks = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7);
      const cells = [];
      for (let i = 0; i < weeks * 7; i++) cells.push(addDays(anchor, i - lead));
      const total = cells.filter((d) => d.getMonth() === m).reduce((n, d) => n + (map.get(ymd(d)) || []).length, 0);
      const head = WEEKDAYS.map((_, i) => {
        const dow = (WEEK_START + i) % 7;
        return `<span class="mhead${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}">${WEEKDAYS[dow]}</span>`;
      }).join('');
      title = `${y}년 ${m + 1}월`;
      sub = `일정 ${total}개`;
      body = `
        <main class="month">
          <div class="mweek-head">${head}</div>
          <div class="mgrid" style="--weeks:${weeks}">${cells.map((d) => renderCell(d, map.get(ymd(d)) || [], m, today)).join('')}</div>
        </main>`;
    } else {
      const days = [];
      for (let i = 0; i < 7; i++) days.push(addDays(anchor, i));
      const end = days[6];
      const total = days.reduce((n, d) => n + (map.get(ymd(d)) || []).length, 0);
      title = weekTitle(anchor);
      sub = `일정 ${total}개`;
      body = `<main class="list week">${days.map((d, idx) => renderRow(d, map.get(ymd(d)) || [], idx, today)).join('')}</main>`;
    }
    const goals = goalsFor(mode, anchor);
    const goalsDone = goals.filter((g) => g.done).length;

    return `
      <header class="topbar">
        <div class="topbar-row">
          <button class="icon-btn" data-act="prev" aria-label="${mode === 'month' ? '이전 달' : '이전 주'}">‹</button>
          <h1 class="title">${title}</h1>
          <button class="icon-btn" data-act="next" aria-label="${mode === 'month' ? '다음 달' : '다음 주'}">›</button>
          <span class="spacer"></span>
          <button class="text-btn" data-act="today">오늘</button>
          <button class="icon-btn" data-act="menu" aria-label="메뉴">⋯</button>
        </div>
        <div class="topbar-row">
          <button class="goal-chip" data-act="goals-open" aria-label="${mode === 'month' ? '월간' : '주간'} 목표 보기">🎯 목표${goals.length ? ` ${goalsDone}/${goals.length}` : ''}</button>
          <p class="sub">${sub}</p>
          <span class="spacer"></span>
          <div class="segmented" role="tablist" aria-label="보기 방식">
            <button role="tab" aria-selected="${mode === 'month'}" class="seg${mode === 'month' ? ' active' : ''}" data-act="mode-month">월간</button>
            <button role="tab" aria-selected="${mode === 'week'}" class="seg${mode === 'week' ? ' active' : ''}" data-act="mode-week">주간</button>
          </div>
        </div>
      </header>
      ${body}
      ${fabs('')}`;
  }

  function weekTitle(start) {
    const end = addDays(start, 6);
    return start.getMonth() === end.getMonth()
      ? `${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getDate()}일`
      : `${fmtMonthDay(start)} – ${fmtMonthDay(end)}`;
  }

  // ---------- 목표 (주간/월간) ----------
  const periodKey = (period, d) => (period === 'week' ? ymd(startOfWeek(d)) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);

  function goalsFor(period, d) {
    const key = periodKey(period, d);
    return db.goals.filter((g) => g.period === period && g.key === key);
  }

  function periodLabel(period, d) {
    return period === 'week' ? weekTitle(startOfWeek(d)) : `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  }

  const findGoal = (id) => db.goals.find((g) => g.id === id);

  function touchGoal(g) {
    g.updatedAt = new Date().toISOString();
    save();
  }

  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderGoals(period, anchor) {
    const goals = goalsFor(period, anchor);
    const unit = period === 'week' ? '주' : '달';
    const year = period === 'week' ? `${anchor.getFullYear()}년 · ` : '';
    const doneCount = goals.filter((g) => g.done).length;
    return `
      <header class="topbar">
        <div class="topbar-row">
          <button class="text-btn back" data-act="goals-back">‹ 달력</button>
          <span class="spacer"></span>
          <div class="segmented" role="tablist" aria-label="목표 기간">
            <button role="tab" aria-selected="${period === 'week'}" class="seg${period === 'week' ? ' active' : ''}" data-act="goals-week">주간 목표</button>
            <button role="tab" aria-selected="${period === 'month'}" class="seg${period === 'month' ? ' active' : ''}" data-act="goals-month">월간 목표</button>
          </div>
        </div>
        <div class="topbar-row">
          <button class="icon-btn" data-act="prev" aria-label="이전 ${unit}">‹</button>
          <h1 class="title">${periodLabel(period, anchor)}</h1>
          <button class="icon-btn" data-act="next" aria-label="다음 ${unit}">›</button>
          <span class="spacer"></span>
          <button class="text-btn" data-act="today">이번 ${unit}</button>
        </div>
        <p class="sub">${year}목표 ${goals.length}개${goals.length ? ` · 달성 ${doneCount}개` : ''}</p>
      </header>
      <main class="goals">
        <form class="quick" data-form="goal-add" autocomplete="off">
          <input name="title" placeholder="이번 ${unit} 목표 추가 (예: 책 한 권 읽기)" maxlength="100" enterkeyhint="done">
          <button type="submit" class="quick-btn">추가</button>
        </form>
        ${goals.length ? goals.map(goalCard).join('') : `<p class="empty">아직 이번 ${unit} 목표가 없어요.<br>위에 목표를 적고, 세부 할 일로 나눠보세요.</p>`}
      </main>`;
  }

  function goalCard(g) {
    const subs = g.subtasks || [];
    const doneSubs = subs.filter((s) => s.done).length;
    const pct = subs.length ? Math.round((doneSubs / subs.length) * 100) : g.done ? 100 : 0;
    return `
      <section class="goal${g.done ? ' done' : ''}">
        <div class="goal-head">
          <button class="check" data-act="goal-toggle" data-id="${g.id}" role="checkbox" aria-checked="${!!g.done}" aria-label="목표 달성 표시">${CHECK_SVG}</button>
          <button class="goal-title" data-act="goal-rename" data-id="${g.id}" aria-label="목표 이름 바꾸기">${esc(g.title)}</button>
          <span class="goal-progress">${subs.length ? `${doneSubs}/${subs.length}` : ''}</span>
          <button class="sub-btn" data-act="goal-delete" data-id="${g.id}" aria-label="목표 삭제">✕</button>
        </div>
        <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
        ${subs.length ? `<ul class="subtasks">${subs.map((s) => `
          <li class="sub${s.done ? ' done' : ''}">
            <button class="check small" data-act="sub-toggle" data-goal="${g.id}" data-id="${s.id}" role="checkbox" aria-checked="${!!s.done}" aria-label="세부 할 일 완료 표시">${CHECK_SVG}</button>
            <span class="sub-title">${esc(s.title)}</span>
            <button class="sub-btn" data-act="sub-schedule" data-goal="${g.id}" data-id="${s.id}" aria-label="달력에 일정으로 추가">📅</button>
            <button class="sub-btn" data-act="sub-delete" data-goal="${g.id}" data-id="${s.id}" aria-label="세부 할 일 삭제">✕</button>
          </li>`).join('')}</ul>` : ''}
        <form class="sub-add" data-form="sub-add" data-goal="${g.id}" autocomplete="off">
          <input name="title" placeholder="세부 할 일 추가" maxlength="100" enterkeyhint="done">
          <button type="submit" aria-label="세부 할 일 추가">+</button>
        </form>
        <button class="ai-link" data-act="goal-ai" data-id="${g.id}">✨ AI로 세부 할 일 만들기</button>
      </section>`;
  }

  // 월간 격자의 날짜 칸 (구글 캘린더 형식)
  function renderCell(d, items, month, today) {
    const ds = ymd(d);
    const dow = d.getDay();
    const cls = ['mcell'];
    if (d.getMonth() !== month) cls.push('other');
    if (ds === today) cls.push('today');
    if (dow === 0) cls.push('sun');
    if (dow === 6) cls.push('sat');
    const shown = items.slice(0, MONTH_PREVIEW_LIMIT);
    const more = items.length - shown.length;
    return `
      <button class="${cls.join(' ')}" data-act="open-day" data-date="${ds}" aria-label="${fmtMonthDay(d)} ${WEEKDAYS[dow]}요일, 일정 ${items.length}개">
        <span class="mnum">${d.getDate()}</span>
        ${shown.map((it) => `<span class="mchip${it.done ? ' done' : ''}" style="--c:${colorOf(it)}">${esc(it.title)}</span>`).join('')}
        ${more > 0 ? `<span class="mmore">+${more}</span>` : ''}
      </button>`;
  }

  // 주간 뷰의 날짜 줄 (세로 나열)
  function renderRow(d, items, idx, today) {
    const ds = ymd(d);
    const dow = d.getDay();
    const cls = ['day-row'];
    if (ds === today) cls.push('today');
    if (ds < today) cls.push('past');
    if (dow === 0) cls.push('sun');
    if (dow === 6) cls.push('sat');

    const body = items.length ? items.map((it) => chip(it, true)).join('') : '<span class="empty-hint">일정 없음</span>';
    const monthTag = idx === 0 || d.getDate() === 1 ? `<span class="day-mon">${d.getMonth() + 1}월</span>` : '';

    return `
      <div class="${cls.join(' ')}">
        <button class="day-main" data-act="open-day" data-date="${ds}" aria-label="${fmtMonthDay(d)} ${WEEKDAYS[dow]}요일, 일정 ${items.length}개">
          <span class="day-label">${monthTag}<span class="day-num">${d.getDate()}</span><span class="day-wd">${WEEKDAYS[dow]}</span></span>
          <span class="day-items">${body}</span>
        </button>
        <button class="add-btn" data-act="add" data-date="${ds}" aria-label="${fmtMonthDay(d)}에 일정 추가">+</button>
      </div>`;
  }

  function chip(it, full) {
    const time = it.start ? `<span class="chip-time">${full ? timeLabel(it) : it.start}</span>` : '';
    const notes = full && it.notes ? `<span class="chip-notes">${esc(it.notes)}</span>` : '';
    return `<span class="chip${it.done ? ' done' : ''}" style="--c:${colorOf(it)}"><i></i>${time}<span class="chip-title">${esc(it.title)}</span></span>${notes}`;
  }

  function renderDay(d) {
    const ds = ymd(d);
    const items = itemsOn(ds);
    const untimed = items.filter((i) => !i.start);
    const timed = items.filter((i) => i.start);
    const now = new Date();
    const rel = ds === ymd(now) ? '오늘' : ds === ymd(addDays(now, 1)) ? '내일' : ds === ymd(addDays(now, -1)) ? '어제' : '';
    const doneCount = items.filter((i) => i.done).length;
    const backLabel = returnHash && returnHash.startsWith('#/week') ? '주간' : `${d.getMonth() + 1}월`;
    const dowCls = d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '';
    const sub = [`${d.getFullYear()}년`, rel, items.length ? `일정 ${items.length}개 · 완료 ${doneCount}개` : ''].filter(Boolean).join(' · ');

    const section = (label, list) => `
      <section class="section">
        <h2 class="section-title">${label}</h2>
        <div class="items">${list.map(itemRow).join('')}</div>
      </section>`;

    return `
      <header class="topbar">
        <div class="topbar-row">
          <button class="text-btn back" data-act="back">‹ ${backLabel}</button>
          <span class="spacer"></span>
          <button class="icon-btn" data-act="prev-day" aria-label="전날">‹</button>
          <button class="text-btn" data-act="goto-today">오늘</button>
          <button class="icon-btn" data-act="next-day" aria-label="다음 날">›</button>
        </div>
        <h1 class="day-title${dowCls}">${fmtMonthDay(d)} <span>${WEEKDAYS[d.getDay()]}요일</span></h1>
        <p class="sub">${sub}</p>
      </header>
      <main class="day-detail">
        <form class="quick" data-form="quick" data-date="${ds}" autocomplete="off">
          <input name="title" placeholder="빠르게 추가 (예: 14:00 치과)" enterkeyhint="done" maxlength="100">
          <button type="submit" class="quick-btn">추가</button>
        </form>
        ${items.length === 0 ? '<p class="empty">아직 일정이 없어요.<br>위에 바로 적거나 + 버튼을 눌러 추가하세요.</p>' : ''}
        ${untimed.length ? section('종일 · 할 일', untimed) : ''}
        ${timed.length ? section('시간 일정', timed) : ''}
      </main>
      ${fabs(ds)}`;
  }

  function fabs(ds) {
    return `
      <button class="fab fab-ai" data-act="ai" aria-label="Claude 비서">✨</button>
      <button class="fab" data-act="add"${ds ? ` data-date="${ds}"` : ''} aria-label="새 일정">+</button>`;
  }

  function itemRow(it) {
    const cat = categoryOf(it);
    return `
      <div class="item${it.done ? ' done' : ''}" style="--c:${colorOf(it)}">
        <button class="check" data-act="toggle" data-id="${it.id}" role="checkbox" aria-checked="${!!it.done}" aria-label="완료 표시">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
        <button class="item-body" data-act="edit" data-id="${it.id}">
          <span class="item-time">${timeLabel(it)}${cat ? ` · ${esc(cat.name)}` : ''}</span>
          <span class="item-title">${esc(it.title)}</span>
          ${it.notes ? `<span class="item-notes">${esc(it.notes)}</span>` : ''}
        </button>
      </div>`;
  }

  // ---------- 시트(편집/메뉴) ----------
  function defaultAddDate() {
    const r = parseRoute();
    const t = new Date();
    if (r.view === 'day') return ymd(r.date);
    if (r.view === 'month' || r.period === 'month') return ymd(sameMonth(t, r.date) ? t : r.date);
    return ymd(t >= r.date && t < addDays(r.date, 7) ? t : r.date);
  }

  function openSheet(html) {
    sheetRoot.innerHTML = `<div class="backdrop" data-act="close-sheet"></div>${html}`;
    sheetRoot.classList.add('open');
    document.body.classList.add('no-scroll');
  }

  function closeSheet() {
    sheetRoot.classList.remove('open');
    sheetRoot.innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  function openEditor({ id, date, title }) {
    const it = id ? db.items.find((i) => i.id === id) : null;
    const catId = it ? it.categoryId : db.categories[0].id;
    openSheet(`
      <form class="sheet" data-form="editor" role="dialog" aria-modal="true" aria-label="${it ? '일정 수정' : '새 일정'}" autocomplete="off">
        <div class="sheet-head">
          <button type="button" class="text-btn" data-act="close-sheet">취소</button>
          <h2>${it ? '일정 수정' : '새 일정'}</h2>
          <button type="submit" class="text-btn strong">저장</button>
        </div>
        <input type="hidden" name="id" value="${it ? it.id : ''}">
        <input class="field-title" name="title" placeholder="제목" required maxlength="100" value="${esc(it ? it.title : title || '')}">
        <div class="group">
          <label class="row"><span>날짜</span><input type="date" name="date" required value="${it ? it.date : date || defaultAddDate()}"></label>
          <label class="row"><span>시작</span><input type="time" name="start" value="${it ? it.start || '' : ''}"></label>
          <label class="row"><span>종료</span><input type="time" name="end" value="${it ? it.end || '' : ''}"></label>
        </div>
        <p class="hint">시작 시간을 비워두면 종일 일정(할 일)이 돼요.</p>
        <div class="cats" role="radiogroup" aria-label="카테고리">
          ${db.categories.map((c) => `
            <label class="cat"><input type="radio" name="categoryId" value="${c.id}"${c.id === catId ? ' checked' : ''}><span style="--c:${c.color}">${esc(c.name)}</span></label>`).join('')}
        </div>
        <textarea name="notes" rows="3" placeholder="메모" maxlength="1000">${esc(it ? it.notes : '')}</textarea>
        ${it ? `<button type="button" class="danger" data-act="delete" data-id="${it.id}">일정 삭제</button>` : ''}
      </form>`);
    if (!it) sheetRoot.querySelector('.field-title').focus();
  }

  function openMenu() {
    openSheet(`
      <div class="sheet" role="dialog" aria-modal="true" aria-label="메뉴">
        <div class="sheet-head">
          <span></span><h2>메뉴</h2>
          <button type="button" class="text-btn strong" data-act="close-sheet">닫기</button>
        </div>
        <div class="group menu">
          <button class="row" data-act="export"><span>백업 파일 내보내기</span><span class="chev">›</span></button>
          <button class="row" data-act="import"><span>백업 파일 가져오기</span><span class="chev">›</span></button>
        </div>
        <div class="group menu">
          <button class="row" data-act="ai-mode-switch"><span>AI 연결 방식</span><span class="chev">${getAiMode() === 'chat' ? '채팅 복사·붙여넣기' : 'API'} ⇄</span></button>
          <button class="row" data-act="key-setup"><span>Claude API 키 설정</span><span class="chev">${getKey() ? '저장됨 ›' : '›'}</span></button>
        </div>
        <p class="hint">채팅 복사·붙여넣기: 앱이 만든 요청문을 Claude 채팅에 붙여넣고 답을 다시 붙여넣어요(API 비용 없음, 테스트용). API: 키를 넣으면 앱이 바로 Claude를 불러요.</p>
        <p class="hint">일정은 이 기기의 브라우저에만 저장돼요. 가끔 백업 파일을 내보내 두세요. (저장된 일정 ${db.items.length}개)</p>
      </div>`);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...db }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `일정백업-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const data = JSON.parse(text);
      if (!Array.isArray(data.items)) throw new Error('형식 오류');
      if (!confirm(`일정 ${data.items.length}개를 가져올까요?\n현재 일정은 모두 바뀌어요.`)) return;
      db = normalizeDb(data);
      save();
      closeSheet();
      render({ scroll: 'keep' });
    }).catch(() => alert('백업 파일을 읽지 못했어요.'));
  });

  // ---------- Claude 비서 ----------
  // API 키는 이 기기의 localStorage에만 저장(백업 파일에 포함 안 됨). 요청은 Anthropic API로 직접 간다.
  const AI_MODEL = 'claude-haiku-5-5';
  const AI_KEY_STORE = 'schedule-app:anthropic-key';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
  const AI_SYSTEM = `당신은 한국어 사용자의 개인 일정 앱에 들어 있는 일정 비서입니다.
사용자의 말을 읽고, 일정 앱에 적용할 변경(actions)과 짧은 답변(reply)을 JSON으로 돌려줍니다.

규칙:
- 상대적인 날짜("오늘", "내일", "다음 주 화요일", "이번 주말")는 <context>의 현재 날짜와 날짜 목록을 기준으로 정확한 YYYY-MM-DD로 바꿉니다.
- 시간은 24시간 HH:mm. "7시에 퇴근", "저녁 7시"처럼 맥락상 오후가 자연스러우면 19:00으로 해석합니다. 시간이 없으면 start와 end는 빈 문자열(종일 일정/할 일).
- 종료 시간은 사용자가 말했거나 "1시간 동안"처럼 길이를 말했을 때만 채우고, 아니면 빈 문자열로 둡니다.
- "A하고 B할 거야"처럼 여러 활동이 이어지면 의미 있는 활동마다 따로 일정을 만듭니다. 앞 활동이 끝나는 시각이 다음 활동의 시작 시각이면 그 시각을 씁니다.
- 수정(update)·삭제(delete)는 <context>의 기존 일정 목록에 있는 id만 사용합니다. update는 바뀌지 않는 필드도 기존 값을 그대로 채워 전체 값을 보냅니다. delete도 대상 일정의 현재 값을 채웁니다.
- 새 일정(create)의 id는 빈 문자열입니다.
- categoryId는 내용에 가장 맞는 카테고리를 고릅니다(업무/개인/건강/기타).
- 일정과 관계없는 말이거나 무엇을 바꿀지 확실하지 않으면 actions는 빈 배열로 두고 reply에서 짧게 되묻습니다.
- reply는 한국어로 한두 문장, 무엇을 하려는지 간단히 말합니다.`;

  let sdkPromise = null;
  let aiState = null;

  function getKey() {
    try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; }
  }

  function setKey(key) {
    try {
      if (key) localStorage.setItem(AI_KEY_STORE, key);
      else localStorage.removeItem(AI_KEY_STORE);
    } catch (e) {
      alert('키를 저장하지 못했어요.');
    }
  }

  const maskKey = (k) => (k.length > 14 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '••••');

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).then((m) => m.default).catch((e) => { sdkPromise = null; throw e; });
    }
    return sdkPromise;
  }

  function aiSchema() {
    return {
      type: 'object',
      properties: {
        reply: { type: 'string', description: '사용자에게 보여줄 한국어 한두 문장' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['create', 'update', 'delete'] },
              id: { type: 'string', description: 'update/delete 대상 기존 일정 id. create면 빈 문자열' },
              title: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD' },
              start: { type: 'string', description: 'HH:mm 또는 빈 문자열' },
              end: { type: 'string', description: 'HH:mm 또는 빈 문자열' },
              categoryId: { type: 'string', enum: db.categories.map((c) => c.id) },
              notes: { type: 'string' },
            },
            required: ['op', 'id', 'title', 'date', 'start', 'end', 'categoryId', 'notes'],
            additionalProperties: false,
          },
        },
      },
      required: ['reply', 'actions'],
      additionalProperties: false,
    };
  }

  function aiContext() {
    const now = new Date();
    const from = ymd(addDays(now, -7));
    const to = ymd(addDays(now, 90));
    const items = db.items
      .filter((i) => i.date >= from && i.date <= to)
      .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))
      .slice(0, 300)
      .map((i) => ({ id: i.id, date: i.date, start: i.start || '', end: i.end || '', title: i.title, categoryId: i.categoryId || '', notes: i.notes || '', done: !!i.done }));
    const days = [];
    for (let k = 0; k < 21; k++) {
      const d = addDays(now, k);
      days.push(`${ymd(d)}(${WEEKDAYS[d.getDay()]})`);
    }
    const r = parseRoute();
    const viewing = r.view === 'day' ? `\n사용자가 보고 있는 날짜: ${ymd(r.date)}` : '';
    return `<context>
현재: ${ymd(now)} ${WEEKDAYS[now.getDay()]}요일 ${pad(now.getHours())}:${pad(now.getMinutes())}${viewing}
앞으로 3주 날짜: ${days.join(', ')}
카테고리: ${db.categories.map((c) => `${c.id}=${c.name}`).join(', ')}
기존 일정(${from}~${to}): ${JSON.stringify(items)}
</context>`;
  }

  // 구조화 출력(JSON 스키마)으로 Claude를 한 번 호출하고 파싱한 결과를 돌려준다
  async function callClaude(Anthropic, { system, content, schema, maxTokens }) {
    const client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true });
    const res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude가 이 요청은 처리하지 않았어요. 다르게 말해볼까요?');
    if (res.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸어요. 나눠서 말해주세요.');
    const block = res.content.find((b) => b.type === 'text');
    if (!block) throw new Error('응답을 이해하지 못했어요. 다시 시도해주세요.');
    return JSON.parse(block.text);
  }

  // ---------- AI 연결 방식 ----------
  // chat(기본, 테스트용): 요청문을 Claude 채팅에 복사해 붙여넣고, 답을 다시 앱에 붙여넣는다. API 비용 없음.
  // api: Anthropic API로 바로 호출 (API 키 필요).
  const AI_MODE_STORE = 'schedule-app:ai-mode';

  function getAiMode() {
    try { return localStorage.getItem(AI_MODE_STORE) === 'api' ? 'api' : 'chat'; } catch (e) { return 'chat'; }
  }

  function setAiMode(mode) {
    try { localStorage.setItem(AI_MODE_STORE, mode); } catch (e) { /* 저장 실패 시 이번 세션만 기본값 */ }
  }

  const aiModeName = (mode) => (mode === 'chat' ? 'Claude 채팅 복사·붙여넣기' : 'API (Haiku 5.5)');

  function chatPrompt(req) {
    return `일정 앱이 보낸 요청입니다. 아래 지시를 따르고, 설명 없이 JSON 코드블록 하나로만 답해주세요.

<instructions>
${req.system}
</instructions>

${req.content}

<output_format>
아래 JSON 스키마를 따르는 JSON 객체 하나를 \`\`\`json 코드블록으로 답하세요. required 필드는 모두 채웁니다.
${JSON.stringify(req.schema)}
</output_format>`;
  }

  // Claude 채팅 답변에서 JSON 객체를 꺼낸다 (코드블록이 있으면 그 안, 없으면 첫 { ~ 마지막 })
  function extractJson(text) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const s = fence ? fence[1] : text;
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('답변에서 JSON을 찾지 못했어요. Claude 답변 전체를 복사해서 붙여넣어 주세요.');
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch (e) {
      throw new Error('JSON 형식이 올바르지 않아요. 답변을 빠짐없이 복사했는지 확인해주세요.');
    }
  }

  let relayFinish = null; // 채팅 방식: 붙여넣은 답을 처리할 함수

  // 요청 하나를 연결 방식에 따라 처리. finish(out)는 JSON을 화면용 결과로 바꾸고, update(patch)는 상태를 갱신·렌더한다.
  async function dispatchAi(req, finish, update) {
    if (getAiMode() === 'chat') {
      relayFinish = (answer) => {
        update({ relayAnswer: answer });
        try {
          update({ result: finish(extractJson(answer)), error: '' });
        } catch (e) {
          update({ error: e.message });
        }
      };
      update({ loading: false, result: null, error: '', relay: chatPrompt(req), relayAnswer: '' });
      return;
    }
    update({ loading: true, result: null, error: '', relay: null });
    let Anthropic;
    try {
      Anthropic = await loadSdk();
    } catch (e) {
      update({ loading: false, error: 'Claude 연결 모듈을 불러오지 못했어요. 인터넷 연결을 확인해주세요.' });
      return;
    }
    try {
      update({ loading: false, result: finish(await callClaude(Anthropic, req)) });
    } catch (e) {
      update({ loading: false, error: aiErrorMessage(e, Anthropic) });
    }
  }

  function relayHtml(state) {
    return `
      <div class="relay">
        <p class="relay-step"><b>①</b> 요청문을 복사해서 Claude 채팅에 붙여넣으세요</p>
        <textarea class="relay-prompt" readonly rows="4" aria-label="Claude에게 보낼 요청문">${esc(state.relay)}</textarea>
        <div class="relay-btns">
          <button type="button" class="primary" data-act="relay-copy">요청문 복사</button>
          <a class="secondary" href="https://claude.ai/new" target="_blank" rel="noopener">Claude 열기 ↗</a>
        </div>
        <p class="relay-step"><b>②</b> Claude의 답변을 복사해서 여기에 붙여넣으세요</p>
        <textarea class="relay-answer" rows="4" placeholder="답변 전체를 붙여넣어도 돼요">${esc(state.relayAnswer || '')}</textarea>
        <button type="button" class="primary" data-act="relay-parse">답변 확인하기</button>
      </div>`;
  }

  function aiModeHint() {
    return `<p class="hint first">연결: <b>${aiModeName(getAiMode())}</b> · <button type="button" class="link-btn" data-act="ai-mode-switch">바꾸기</button></p>`;
  }

  async function copyText(text, fallbackEl) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* 아래 방식으로 재시도 */ }
    try {
      fallbackEl.focus();
      fallbackEl.select();
      return document.execCommand('copy');
    } catch (e) {
      return false;
    }
  }

  // ---------- 목표 → 세부 할 일 AI ----------
  // 토큰 절약: 버튼을 눌러도 바로 호출하지 않고 확인 시트를 거친다. 보내는 내용도 목표 하나와 기존 세부 할 일뿐.
  const SUBTASK_SYSTEM = `개인 목표를 실행 가능한 세부 할 일로 나누는 도우미입니다.
- 목표 기간 안에 끝낼 수 있는 구체적인 행동으로 만듭니다. 각 항목은 한 줄, 40자 이내, "~하기"처럼 행동으로 끝냅니다.
- 요청한 개수만큼, 먼저 할 것부터 순서대로 씁니다.
- 이미 있는 세부 할 일과 겹치지 않게 합니다.
- 한국어로 씁니다.`;

  let goalAiState = null;

  function openGoalAi(goalId) {
    const g = findGoal(goalId);
    if (!g) return;
    const chat = getAiMode() === 'chat';
    if (!chat && !getKey()) {
      openKeySetup(false);
      return;
    }
    goalAiState = { goalId, loading: false, result: null, error: '', relay: null };
    openSheet(`
      <form class="sheet ai-sheet" data-form="goal-ai" role="dialog" aria-modal="true" aria-label="AI로 세부 할 일 만들기" autocomplete="off">
        <div class="sheet-head">
          <button type="button" class="text-btn" data-act="close-sheet">취소</button>
          <h2>✨ 세부 할 일 만들기</h2>
          <span></span>
        </div>
        <p class="ai-goal">🎯 ${esc(g.title)}</p>
        <p class="hint first">${chat
          ? 'Claude 채팅에 붙여넣을 요청문을 만들어요. API 비용은 들지 않아요.'
          : 'Claude에게 이 목표를 세부 할 일로 나눠 달라고 요청할까요? <b>요청하기</b>를 눌러야 AI를 사용해요. (Haiku 5.5, 1회 약 0.05센트 이하)'}</p>
        ${aiModeHint()}
        <div class="group">
          <div class="row"><span>개수</span>
            <span class="count-pick">${[3, 5, 7].map((n) => `<label><input type="radio" name="count" value="${n}"${n === 5 ? ' checked' : ''}><span>${n}개</span></label>`).join('')}</span>
          </div>
        </div>
        <textarea name="extra" rows="2" maxlength="300" placeholder="추가 요청 (선택) 예: 평일 저녁 30분 안에 할 수 있는 것 위주로"></textarea>
        <button type="submit" class="primary" data-ai-send>${chat ? '요청문 만들기' : '요청하기'}</button>
        <div class="ai-body" aria-live="polite"></div>
      </form>`);
  }

  function renderGoalAiBody() {
    const body = sheetRoot.querySelector('.ai-body');
    const s = goalAiState;
    if (!body || !s) return;
    const send = sheetRoot.querySelector('[data-ai-send]');
    send.disabled = s.loading;
    send.textContent = s.loading ? '만드는 중…'
      : getAiMode() === 'chat' ? (s.relay || s.result ? '요청문 다시 만들기' : '요청문 만들기')
        : s.result ? '다시 요청하기' : '요청하기';
    let html = '';
    if (s.relay && !s.result) html += relayHtml(s);
    if (s.error) html += `<p class="ai-error">${esc(s.error)}</p>`;
    if (s.result) {
      html += s.result.length ? `
        <div class="ai-actions">
          ${s.result.map((t, i) => `
            <label class="ai-action">
              <input type="checkbox" name="pick" value="${i}" checked>
              <span class="ai-desc">${esc(t)}</span>
            </label>`).join('')}
        </div>
        <button type="button" class="primary" data-act="goal-ai-apply">선택한 세부 할 일 추가</button>` : '<p class="ai-error">만들어진 세부 할 일이 없어요. 추가 요청을 바꿔 다시 시도해보세요.</p>';
    }
    body.innerHTML = html;
  }

  function runGoalAi(count, extra) {
    const g = findGoal(goalAiState.goalId);
    if (!g) return;
    const start = g.period === 'week' ? parseYmd(g.key) : parseYmd(`${g.key}-01`);
    const existing = (g.subtasks || []).map((s) => `- ${s.title}`).join('\n') || '없음';
    const req = {
      system: SUBTASK_SYSTEM,
      content: `<goal>${g.title}</goal>
기간: ${g.period === 'week' ? '주간' : '월간'} 목표, ${periodLabel(g.period, start)}
오늘: ${todayStr()}
이미 있는 세부 할 일:
${existing}
만들 개수: ${count}${extra ? `\n<extra_request>${extra}</extra_request>` : ''}`,
      schema: {
        type: 'object',
        properties: { subtasks: { type: 'array', items: { type: 'string' } } },
        required: ['subtasks'],
        additionalProperties: false,
      },
      maxTokens: 2048,
    };
    const finish = (out) => {
      const have = new Set((g.subtasks || []).map((s) => s.title));
      return (Array.isArray(out.subtasks) ? out.subtasks : [])
        .map((t) => String(t).trim().slice(0, 100))
        .filter((t) => t && !have.has(t) && (have.add(t), true))
        .slice(0, count);
    };
    dispatchAi(req, finish, (patch) => {
      goalAiState = Object.assign({}, goalAiState, patch);
      renderGoalAiBody();
    });
  }

  function addSubtasks(g, titles) {
    g.subtasks = g.subtasks || [];
    for (const title of titles) g.subtasks.push({ id: uid(), title, done: false });
    if (titles.length) g.done = false;
    touchGoal(g);
  }

  // Claude가 돌려준 변경안을 검증: 존재하지 않는 id, 잘못된 날짜·시간은 버리거나 비운다
  function sanitizeActions(list) {
    const reDate = /^\d{4}-\d{2}-\d{2}$/;
    const reTime = /^([01]\d|2[0-3]):[0-5]\d$/;
    const out = [];
    for (const a of list) {
      if (!a || !['create', 'update', 'delete'].includes(a.op)) continue;
      const before = a.op === 'create' ? null : db.items.find((i) => i.id === a.id);
      if (a.op !== 'create' && !before) continue;
      if (a.op === 'delete') {
        out.push({ op: 'delete', id: before.id, before });
        continue;
      }
      const title = String(a.title || '').trim().slice(0, 100);
      if (!title || !reDate.test(a.date || '')) continue;
      const start = reTime.test(a.start || '') ? a.start : '';
      const end = start && reTime.test(a.end || '') && a.end > start ? a.end : '';
      const categoryId = db.categories.some((c) => c.id === a.categoryId) ? a.categoryId : db.categories[0].id;
      out.push({
        op: a.op,
        id: before ? before.id : undefined,
        before,
        data: { title, date: a.date, start, end, categoryId, notes: String(a.notes || '').trim().slice(0, 1000) },
      });
    }
    return out;
  }

  function aiErrorMessage(e, Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. ⋯ 메뉴 → Claude API 키 설정에서 확인해주세요.';
    if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 사용할 수 없어요 (권한 없음).';
    if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 후 다시 시도해주세요.';
    if (e instanceof Anthropic.APIConnectionError) return '인터넷 연결을 확인해주세요.';
    if (e instanceof Anthropic.BadRequestError) {
      return /credit/i.test(e.message) ? 'API 크레딧이 부족해요. console.anthropic.com에서 충전해주세요.' : `요청 오류: ${e.message}`;
    }
    if (e instanceof Anthropic.APIError) return `Claude 서버 오류(${e.status || '?'})예요. 잠시 후 다시 시도해주세요.`;
    return e && e.message ? e.message : '알 수 없는 오류가 났어요.';
  }

  function openAi() {
    const chat = getAiMode() === 'chat';
    if (!chat && !getKey()) {
      openKeySetup(true);
      return;
    }
    aiState = { loading: false, result: null, error: '', relay: null };
    openSheet(`
      <form class="sheet ai-sheet" data-form="ai" role="dialog" aria-modal="true" aria-label="Claude 비서" autocomplete="off">
        <div class="sheet-head">
          <button type="button" class="text-btn" data-act="close-sheet">닫기</button>
          <h2>✨ Claude 비서</h2>
          <span></span>
        </div>
        ${aiModeHint()}
        <textarea name="text" rows="3" maxlength="1000" placeholder="예: 오늘 7시에 퇴근해서 운동할 거야&#10;예: 내일 치과 3시로 옮겨줘"></textarea>
        <button type="submit" class="primary" data-ai-send>${chat ? '요청문 만들기' : '보내기'}</button>
        <div class="ai-body" aria-live="polite"></div>
      </form>`);
    sheetRoot.querySelector('textarea').focus();
  }

  function aiActionLabel(a) {
    const fmt = (x) => {
      const d = parseYmd(x.date);
      const time = x.start ? (x.end ? `${x.start}–${x.end}` : x.start) : '종일';
      return `${fmtMonthDay(d)}(${WEEKDAYS[d.getDay()]}) ${time} · ${esc(x.title)}`;
    };
    if (a.op === 'create') return fmt(a.data);
    if (a.op === 'delete') return fmt(a.before);
    return `<s>${fmt(a.before)}</s><br>→ ${fmt(a.data)}`;
  }

  function renderAiBody() {
    const body = sheetRoot.querySelector('.ai-body');
    const s = aiState;
    if (!body || !s) return;
    const send = sheetRoot.querySelector('[data-ai-send]');
    send.disabled = s.loading;
    send.textContent = s.loading ? '생각하는 중…'
      : getAiMode() === 'chat' ? (s.relay || s.result ? '요청문 다시 만들기' : '요청문 만들기') : '보내기';

    let html = '';
    if (s.relay && !s.result) html += relayHtml(s);
    if (s.error) html += `<p class="ai-error">${esc(s.error)}</p>`;
    const r = s.result;
    if (r) {
      const opName = { create: '추가', update: '수정', delete: '삭제' };
      html += `
        ${r.reply ? `<p class="ai-reply">${esc(r.reply)}</p>` : ''}
        ${r.actions.length ? `
          <div class="ai-actions">
            ${r.actions.map((a, i) => `
              <label class="ai-action">
                <input type="checkbox" name="pick" value="${i}" checked>
                <span class="ai-op op-${a.op}">${opName[a.op]}</span>
                <span class="ai-desc">${aiActionLabel(a)}</span>
              </label>`).join('')}
          </div>
          <button type="button" class="primary" data-act="ai-apply">선택한 일정 반영하기</button>` : ''}`;
    }
    body.innerHTML = html;
  }

  function runAi(text) {
    const req = { system: AI_SYSTEM, content: `${aiContext()}\n\n<request>\n${text}\n</request>`, schema: aiSchema(), maxTokens: 4096 };
    const finish = (out) => {
      const result = { reply: String(out.reply || ''), actions: sanitizeActions(Array.isArray(out.actions) ? out.actions : []) };
      if (!result.reply && !result.actions.length) result.reply = '반영할 일정을 찾지 못했어요. 조금 더 구체적으로 말해주세요.';
      return result;
    };
    dispatchAi(req, finish, (patch) => {
      aiState = Object.assign({}, aiState, patch);
      renderAiBody();
    });
  }

  function applyAiActions(actions) {
    for (const a of actions) {
      if (a.op === 'delete') removeItem(a.id);
      else if (a.op === 'update') upsert(Object.assign({}, a.data, { id: a.id }));
      else upsert(a.data);
    }
  }

  function openKeySetup(thenAi) {
    const key = getKey();
    openSheet(`
      <form class="sheet" data-form="apikey" data-then-ai="${thenAi ? '1' : ''}" role="dialog" aria-modal="true" aria-label="Claude API 키" autocomplete="off">
        <div class="sheet-head">
          <button type="button" class="text-btn" data-act="close-sheet">취소</button>
          <h2>Claude API 키</h2>
          <button type="submit" class="text-btn strong">저장</button>
        </div>
        <p class="hint first">Claude 비서를 쓰려면 Anthropic API 키가 필요해요. console.anthropic.com → API Keys에서 만들 수 있어요. (Claude 구독과는 별도 결제)</p>
        ${key ? `<p class="key-status">저장된 키: <code>${esc(maskKey(key))}</code></p>` : ''}
        <input class="field-title" type="password" name="key" placeholder="${key ? '새 키로 바꾸려면 입력' : 'sk-ant-...'}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <p class="hint">키는 이 기기에만 저장되고 Anthropic 서버로만 전송돼요. 백업 파일에는 포함되지 않아요. Console에서 월 사용 한도를 꼭 걸어두세요. · 모델: Claude Haiku 5.5</p>
        ${key ? '<button type="button" class="danger" data-act="key-delete">저장된 키 삭제</button>' : ''}
      </form>`);
    sheetRoot.querySelector('input[name="key"]').focus();
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const r = parseRoute();
    switch (el.dataset.act) {
      case 'prev':
      case 'next': {
        const step = el.dataset.act === 'prev' ? -1 : 1;
        if (r.view === 'goals') {
          // 목표 화면 안의 기간 이동은 기록을 쌓지 않는다 (‹ 달력 한 번으로 돌아가게)
          location.replace(goalsHash(r.period, r.period === 'week' ? addDays(r.date, 7 * step) : new Date(r.date.getFullYear(), r.date.getMonth() + step, 1)));
        } else if (r.view === 'month') go(monthHash(new Date(r.date.getFullYear(), r.date.getMonth() + step, 1)));
        else go(weekHash(addDays(r.date, 7 * step)));
        break;
      }
      case 'goals-open':
        goalsReturn = location.hash;
        go(goalsHash(r.view === 'week' ? 'week' : 'month', r.view === 'week' ? r.date : sameMonth(new Date(), r.date) ? new Date() : r.date));
        break;
      case 'goals-back':
        if (goalsReturn) { goalsReturn = null; history.back(); } else go(r.period === 'week' ? weekHash(r.date) : monthHash(r.date));
        break;
      case 'goals-week':
        if (r.period !== 'week') location.replace(goalsHash('week', sameMonth(new Date(), r.date) ? new Date() : r.date));
        break;
      case 'goals-month':
        if (r.period !== 'month') location.replace(goalsHash('month', addDays(r.date, 3)));
        break;
      case 'goal-toggle': {
        const g = findGoal(el.dataset.id);
        if (g) { g.done = !g.done; touchGoal(g); render({ scroll: 'keep' }); }
        break;
      }
      case 'goal-rename': {
        const g = findGoal(el.dataset.id);
        const title = g && prompt('목표 이름', g.title);
        if (title && title.trim()) { g.title = title.trim().slice(0, 100); touchGoal(g); render({ scroll: 'keep' }); }
        break;
      }
      case 'goal-delete': {
        const g = findGoal(el.dataset.id);
        if (g && confirm(`"${g.title}" 목표와 세부 할 일을 모두 삭제할까요?`)) {
          db.goals = db.goals.filter((x) => x.id !== g.id);
          save();
          render({ scroll: 'keep' });
        }
        break;
      }
      case 'sub-toggle': {
        const g = findGoal(el.dataset.goal);
        const s = g && g.subtasks.find((x) => x.id === el.dataset.id);
        if (s) {
          s.done = !s.done;
          g.done = g.subtasks.every((x) => x.done); // 세부 할 일을 모두 끝내면 목표도 달성
          touchGoal(g);
          render({ scroll: 'keep' });
        }
        break;
      }
      case 'sub-delete': {
        const g = findGoal(el.dataset.goal);
        if (g) { g.subtasks = g.subtasks.filter((x) => x.id !== el.dataset.id); touchGoal(g); render({ scroll: 'keep' }); }
        break;
      }
      case 'sub-schedule': {
        const g = findGoal(el.dataset.goal);
        const s = g && g.subtasks.find((x) => x.id === el.dataset.id);
        if (s) openEditor({ title: s.title });
        break;
      }
      case 'goal-ai':
        openGoalAi(el.dataset.id);
        break;
      case 'relay-copy': {
        const ta = sheetRoot.querySelector('.relay-prompt');
        if (ta) copyText(ta.value, ta).then((ok) => toast(ok ? '요청문을 복사했어요. Claude 채팅에 붙여넣으세요' : '복사하지 못했어요. 요청문을 길게 눌러 직접 복사해주세요'));
        break;
      }
      case 'relay-parse': {
        const ta = sheetRoot.querySelector('.relay-answer');
        const answer = ta ? ta.value.trim() : '';
        if (!answer) alert('Claude의 답변을 붙여넣어 주세요.');
        else if (relayFinish) relayFinish(answer);
        break;
      }
      case 'ai-mode-switch': {
        const next = getAiMode() === 'chat' ? 'api' : 'chat';
        setAiMode(next);
        toast(`AI 연결: ${aiModeName(next)}`);
        const form = el.closest('form');
        if (form && form.dataset.form === 'ai') {
          const text = form.elements.namedItem('text').value;
          openAi();
          const ta = sheetRoot.querySelector('[data-form="ai"] textarea[name="text"]');
          if (ta) ta.value = text;
        } else if (form && form.dataset.form === 'goal-ai' && goalAiState) {
          openGoalAi(goalAiState.goalId);
        } else {
          openMenu();
        }
        break;
      }
      case 'goal-ai-apply': {
        const g = goalAiState && findGoal(goalAiState.goalId);
        const picks = [...sheetRoot.querySelectorAll('input[name="pick"]:checked')].map((i) => goalAiState.result[Number(i.value)]);
        if (!g || !picks.length) {
          alert('추가할 세부 할 일을 하나 이상 선택해주세요.');
          break;
        }
        addSubtasks(g, picks);
        closeSheet();
        render({ scroll: 'keep' });
        toast(`세부 할 일 ${picks.length}개를 추가했어요`);
        break;
      }
      case 'today': {
        if (r.view === 'goals') {
          location.replace(goalsHash(r.period, new Date()));
          break;
        }
        const h = r.view === 'week' ? weekHash(new Date()) : monthHash(new Date());
        delete scrollMemo[h];
        go(h);
        break;
      }
      case 'mode-month':
        if (r.view !== 'month') go(monthHash(addDays(r.date, 3))); // 주의 가운데(수요일)가 속한 달
        break;
      case 'mode-week':
        if (r.view !== 'week') go(weekHash(sameMonth(new Date(), r.date) ? new Date() : r.date));
        break;
      case 'open-day':
        returnHash = location.hash;
        go(dayHash(parseYmd(el.dataset.date)));
        break;
      case 'back':
        if (returnHash) { returnHash = null; history.back(); } else go(monthHash(r.date));
        break;
      case 'prev-day':
        location.replace(dayHash(addDays(r.date, -1)));
        break;
      case 'next-day':
        location.replace(dayHash(addDays(r.date, 1)));
        break;
      case 'goto-today':
        location.replace(dayHash(new Date()));
        break;
      case 'add':
        openEditor({ date: el.dataset.date });
        break;
      case 'edit':
        openEditor({ id: el.dataset.id });
        break;
      case 'toggle':
        toggleDone(el.dataset.id);
        render({ scroll: 'keep' });
        break;
      case 'delete':
        if (confirm('이 일정을 삭제할까요?')) {
          removeItem(el.dataset.id);
          closeSheet();
          render({ scroll: 'keep' });
        }
        break;
      case 'close-sheet':
        closeSheet();
        break;
      case 'menu':
        openMenu();
        break;
      case 'export':
        exportData();
        break;
      case 'import':
        document.getElementById('import-file').click();
        break;
      case 'ai':
        openAi();
        break;
      case 'key-setup':
        openKeySetup(false);
        break;
      case 'key-delete':
        if (confirm('저장된 API 키를 삭제할까요?')) {
          setKey('');
          closeSheet();
          toast('API 키를 삭제했어요');
        }
        break;
      case 'ai-apply': {
        const picks = [...sheetRoot.querySelectorAll('input[name="pick"]:checked')].map((i) => aiState.result.actions[Number(i.value)]);
        if (!picks.length) {
          alert('반영할 일정을 하나 이상 선택해주세요.');
          break;
        }
        applyAiActions(picks);
        closeSheet();
        render({ scroll: 'keep' });
        toast(`일정 ${picks.length}개를 반영했어요`);
        break;
      }
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.dataset.form) return;
    e.preventDefault();

    if (form.dataset.form === 'quick') {
      const input = form.elements.namedItem('title');
      const { title, start } = parseQuick(input.value);
      if (!title) return;
      upsert({ title, start, end: '', notes: '', date: form.dataset.date, categoryId: db.categories[0].id });
      render({ scroll: 'keep' });
      app.querySelector('.quick input').focus();
      return;
    }

    if (form.dataset.form === 'goal-add') {
      const input = form.elements.namedItem('title');
      const title = input.value.trim().slice(0, 100);
      if (!title) return;
      const r = parseRoute();
      const now = new Date().toISOString();
      db.goals.push({ id: uid(), period: r.period, key: periodKey(r.period, r.date), title, done: false, subtasks: [], createdAt: now, updatedAt: now });
      save();
      render({ scroll: 'keep' });
      app.querySelector('[data-form="goal-add"] input').focus();
      return;
    }

    if (form.dataset.form === 'sub-add') {
      const g = findGoal(form.dataset.goal);
      const title = form.elements.namedItem('title').value.trim().slice(0, 100);
      if (!g || !title) return;
      addSubtasks(g, [title]);
      render({ scroll: 'keep' });
      const again = app.querySelector(`[data-form="sub-add"][data-goal="${g.id}"] input`);
      if (again) again.focus();
      return;
    }

    if (form.dataset.form === 'goal-ai') {
      if (goalAiState && goalAiState.loading) return;
      const fd = new FormData(form);
      runGoalAi(Number(fd.get('count')) || 5, String(fd.get('extra') || '').trim());
      return;
    }

    if (form.dataset.form === 'ai') {
      const text = form.elements.namedItem('text').value.trim();
      if (text && !(aiState && aiState.loading)) runAi(text);
      return;
    }

    if (form.dataset.form === 'apikey') {
      const key = form.elements.namedItem('key').value.trim();
      if (key) {
        if (!key.startsWith('sk-ant-') && !confirm('Anthropic API 키는 보통 sk-ant-로 시작해요. 이대로 저장할까요?')) return;
        setKey(key);
      } else if (!getKey()) {
        return;
      }
      if (form.dataset.thenAi) openAi();
      else {
        closeSheet();
        if (key) toast('API 키를 저장했어요');
      }
      return;
    }

    if (form.dataset.form === 'editor') {
      const fd = new FormData(form);
      const start = fd.get('start') || '';
      let end = start ? fd.get('end') || '' : '';
      if (end && end < start) {
        alert('종료 시간이 시작 시간보다 빨라요.');
        return;
      }
      upsert({
        id: fd.get('id') || undefined,
        title: String(fd.get('title')).trim(),
        date: fd.get('date'),
        start,
        end,
        categoryId: fd.get('categoryId') || db.categories[0].id,
        notes: String(fd.get('notes') || '').trim(),
      });
      closeSheet();
      render({ scroll: 'keep' });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetRoot.classList.contains('open')) closeSheet();
    // Claude 비서 입력창: Ctrl/Cmd + Enter로 보내기
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest && e.target.closest('[data-form="ai"]')) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  window.addEventListener('hashchange', (e) => {
    const oldHash = new URL(e.oldURL).hash;
    if (/^#\/(month|week)\//.test(oldHash)) scrollMemo[oldHash] = window.scrollY;
    closeSheet();
    render({ scroll: 'memo' });
  });

  // 월간·주간에서 좌우로 밀어 이전/다음으로 이동
  let touchStart = null;
  app.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStart = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  app.addEventListener('touchend', (e) => {
    if (!touchStart || parseRoute().view === 'day') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const btn = app.querySelector(`[data-act="${dx < 0 ? 'next' : 'prev'}"]`);
    if (btn) btn.click();
  });

  // 자정이 지나 앱으로 돌아왔을 때 '오늘' 표시 갱신
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !sheetRoot.classList.contains('open')) render({ scroll: 'keep' });
  });

  if (!/^#\/(month|week|day|goals)\//.test(location.hash)) {
    history.replaceState(null, '', monthHash(new Date()));
  }
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
