(() => {
  const root = document.getElementById('demo');
  const stage = document.getElementById('demoStage');
  const dock = document.getElementById('dock');
  const hit = document.getElementById('dockHit');
  const note = document.getElementById('note');
  const surface = note ? note.querySelector('.note-surface') : null;
  const noteText = document.getElementById('noteText');
  const pinBtn = document.getElementById('pinBtn');
  const closeBtn = document.getElementById('closeBtn');
  const saveState = document.getElementById('saveState');
  const saveText = document.getElementById('saveText');
  const dragOrb = document.getElementById('dragOrb');
  const guides = Array.from(document.querySelectorAll('.guide'));
  const tip = document.getElementById('demoTip');
  const resetBtn = document.getElementById('resetDemo');

  if (!root || !stage || !dock || !hit || !note || !surface || !noteText) return;

  const BALL = 58;
  const EDGE_GAP = 39;
  const DRAG_THRESHOLD = 5;
  const PEEK_DELAY = 60;
  const UNPEEK_DELAY = 220;
  const CLOSE_DELAY = 1000;
  const TEXT_KEY = 'side-note-web-demo';
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  const FINE_POINTER = window.matchMedia('(pointer: fine)').matches;

  let edge = 'right';
  let pos = 0;
  let peeked = false;
  let phase = 'closed';
  let pinned = false;
  let press = null;
  let dragging = false;
  let moved = false;
  let dragEdge = 'right';
  let dragPos = 0;

  const timers = { peek: 0, unpeek: 0, open: 0, close: 0, auto: 0, snap: 0, save: 0 };
  let dirty = false;

  const initialTip = () => (COARSE ? '点一下玻璃条，再点笔球。' : '把鼠标移到右边缘的玻璃条上。');

  function setTip(text) {
    tip.textContent = text;
  }

  function stageSize() {
    return { w: stage.clientWidth, h: stage.clientHeight };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function edgeLength(e) {
    const { w, h } = stageSize();
    return e === 'top' || e === 'bottom' ? w : h;
  }

  function clampPos(e, value) {
    const len = edgeLength(e);
    return Math.round(clamp(value, 58, Math.max(58, len - 58)));
  }

  function placeDock() {
    const { w, h } = stageSize();
    pos = clampPos(edge, pos);
    let left = 0;
    let top = 0;
    if (edge === 'right') {
      left = w - 96;
      top = pos - 48;
    } else if (edge === 'left') {
      left = 0;
      top = pos - 48;
    } else if (edge === 'top') {
      left = pos - 48;
      top = 0;
    } else {
      left = pos - 48;
      top = h - 96;
    }
    dock.dataset.edge = edge;
    dock.style.left = `${left}px`;
    dock.style.top = `${top}px`;
  }

  function ballCenter(e = edge, p = pos) {
    const { w, h } = stageSize();
    if (e === 'right') return { x: w - EDGE_GAP, y: p };
    if (e === 'left') return { x: EDGE_GAP, y: p };
    if (e === 'top') return { x: p, y: EDGE_GAP };
    return { x: p, y: h - EDGE_GAP };
  }

  function computeGeometry() {
    const { w, h } = stageSize();
    const nw = Math.min(344, Math.max(220, w - 20));
    const nh = Math.min(500, Math.max(260, h - 20));
    let x = 0;
    let y = 0;
    let ox = EDGE_GAP;
    let oy = EDGE_GAP;

    if (edge === 'right' || edge === 'left') {
      y = clamp(pos - nh / 2, 10, Math.max(10, h - nh - 10));
      if (edge === 'right') {
        x = w - nw;
        ox = nw - EDGE_GAP;
      } else {
        x = 0;
        ox = EDGE_GAP;
      }
      oy = pos - y;
    } else {
      x = clamp(pos - nw / 2, 10, Math.max(10, w - nw - 10));
      if (edge === 'top') {
        y = 0;
        oy = EDGE_GAP;
      } else {
        y = h - nh;
        oy = nh - EDGE_GAP;
      }
      ox = pos - x;
    }

    return { x, y, w: nw, h: nh, ox, oy };
  }

  function applyGeometry(g) {
    note.style.left = `${g.x}px`;
    note.style.top = `${g.y}px`;
    note.style.width = `${g.w}px`;
    note.style.height = `${g.h}px`;
    note.style.setProperty('--ox', `${g.ox}px`);
    note.style.setProperty('--oy', `${g.oy}px`);
    note.style.setProperty('--sx', BALL / g.w);
    note.style.setProperty('--sy', BALL / g.h);
    note.dataset.edge = edge;
  }

  function transitionMs(el, fallback) {
    const raw = (getComputedStyle(el).transitionDuration || '').split(',')[0].trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith('ms') ? value : value * 1000;
  }

  function setPeek(next) {
    if (peeked === next) return;
    peeked = next;
    dock.classList.toggle('is-peek', next);
  }

  function schedulePeek() {
    if (phase !== 'closed') return;
    clearTimeout(timers.peek);
    timers.peek = window.setTimeout(() => {
      setPeek(true);
      setTip(COARSE ? '再点一下笔球，便签会展开。' : '点击笔球，便签会从球里长出来。');
    }, PEEK_DELAY);
  }

  function scheduleUnpeek() {
    if (phase !== 'closed' || dragging || COARSE) return;
    clearTimeout(timers.unpeek);
    timers.unpeek = window.setTimeout(() => {
      if (phase === 'closed' && !dragging) setPeek(false);
    }, UNPEEK_DELAY);
  }

  function updatePin() {
    pinBtn.classList.toggle('is-active', pinned);
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.setAttribute('aria-label', pinned ? '取消固定便签' : '固定便签');
    pinBtn.title = pinned ? '取消固定' : '固定便签';
  }

  /* ---------- note ---------- */
  function finishOpen() {
    if (phase !== 'opening') return;
    phase = 'open';
    note.classList.add('is-ready');
    if (FINE_POINTER) {
      noteText.focus({ preventScroll: true });
      const end = noteText.value.length;
      noteText.setSelectionRange(end, end);
    }
  }

  function openNote() {
    if (phase !== 'closed') return;
    clearTimeout(timers.peek);
    clearTimeout(timers.unpeek);
    applyGeometry(computeGeometry());

    note.classList.remove('is-open', 'is-ready', 'is-closing', 'is-hidden');
    note.setAttribute('aria-hidden', 'false');
    phase = 'opening';

    void note.offsetWidth;
    dock.classList.add('is-handoff');
    root.classList.add('is-note-open');
    setPeek(false);
    note.classList.add('is-open');

    clearTimeout(timers.open);
    timers.open = window.setTimeout(finishOpen, transitionMs(surface, 520) + 50);
    setTip(COARSE ? '写完点右上角 × 收起。' : '写下点什么；移开鼠标 1 秒会自动收起。');
  }

  function finishClose() {
    if (phase !== 'closing') return;
    phase = 'closed';
    note.classList.add('is-hidden');
    note.setAttribute('aria-hidden', 'true');
    dock.classList.remove('is-handoff');
    root.classList.remove('is-note-open');
    setPeek(false);
    dock.classList.add('is-returning');
    window.setTimeout(() => dock.classList.remove('is-returning'), 420);
    setTip('再悬停一次，或者拖动笔球换个位置。');
  }

  function closeNote(instant = false) {
    if (phase !== 'open' && phase !== 'opening') return;
    clearTimeout(timers.open);
    clearTimeout(timers.auto);
    flushSave();
    phase = 'closing';
    pinned = false;
    updatePin();
    note.classList.remove('is-open', 'is-ready');
    note.classList.add('is-closing');
    if (instant) {
      finishClose();
      return;
    }
    clearTimeout(timers.close);
    timers.close = window.setTimeout(finishClose, transitionMs(surface, 360) + 50);
  }

  /* ---------- drag ---------- */
  function stagePoint(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  }

  function updateDragEdge(point) {
    const { w, h } = stageSize();
    const distances = [
      ['left', point.x],
      ['right', w - point.x],
      ['top', point.y],
      ['bottom', h - point.y],
    ].sort((a, b) => a[1] - b[1]);
    dragEdge = distances[0][0];
    const along = dragEdge === 'top' || dragEdge === 'bottom' ? point.x : point.y;
    dragPos = clampPos(dragEdge, along);
    guides.forEach((guide) => {
      guide.classList.toggle('is-active', guide.dataset.edge === dragEdge);
    });
  }

  function startDrag(event) {
    dragging = true;
    clearTimeout(timers.peek);
    clearTimeout(timers.unpeek);
    setPeek(false);
    root.classList.add('is-dragging');
    dock.classList.add('is-handoff');
    dragOrb.classList.remove('is-snapping');
    const point = stagePoint(event);
    dragOrb.style.left = `${point.x}px`;
    dragOrb.style.top = `${point.y}px`;
    updateDragEdge(point);
    setTip('拖到任意一边，松手吸附。');
  }

  function updateDrag(event) {
    const point = stagePoint(event);
    dragOrb.style.left = `${point.x}px`;
    dragOrb.style.top = `${point.y}px`;
    updateDragEdge(point);
  }

  function endDrag(event) {
    dragging = false;
    const point = stagePoint(event);
    updateDragEdge(point);
    const target = ballCenter(dragEdge, dragPos);
    dragOrb.style.left = `${target.x}px`;
    dragOrb.style.top = `${target.y}px`;
    dragOrb.classList.add('is-snapping');

    clearTimeout(timers.snap);
    timers.snap = window.setTimeout(() => {
      edge = dragEdge;
      pos = dragPos;
      placeDock();
      dock.classList.remove('is-handoff');
      root.classList.remove('is-dragging');
      dragOrb.classList.remove('is-snapping');
      dock.classList.add('is-returning');
      window.setTimeout(() => dock.classList.remove('is-returning'), 420);
      setTip('松手就吸附；点笔球打开便签。');
    }, 280);
  }

  function cancelDrag() {
    dragging = false;
    press = null;
    root.classList.remove('is-dragging');
    dock.classList.remove('is-handoff');
    dragOrb.classList.remove('is-snapping');
    setPeek(false);
    setTip(initialTip());
  }

  /* ---------- pointer ---------- */
  hit.addEventListener('pointerenter', schedulePeek);
  hit.addEventListener('pointerleave', scheduleUnpeek);

  hit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || phase !== 'closed') return;
    press = { x: event.clientX, y: event.clientY };
    moved = false;
    dragging = false;
    try {
      hit.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best effort */
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (!press) return;
    if (!moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= DRAG_THRESHOLD) {
      moved = true;
      startDrag(event);
    }
    if (dragging) updateDrag(event);
  });

  window.addEventListener('pointerup', (event) => {
    if (!press) return;
    const wasMoved = moved;
    const wasDragging = dragging;
    press = null;
    if (wasDragging) {
      endDrag(event);
      return;
    }
    if (wasMoved || phase !== 'closed') return;
    if (peeked) openNote();
    else setPeek(true);
  });

  window.addEventListener('pointercancel', () => {
    if (dragging) cancelDrag();
    press = null;
  });

  hit.addEventListener('click', (event) => {
    if (event.detail !== 0 || phase !== 'closed') return;
    if (peeked) openNote();
    else setPeek(true);
  });

  stage.addEventListener('pointerdown', (event) => {
    if (phase !== 'open') return;
    if (note.contains(event.target) || dock.contains(event.target)) return;
    closeNote();
  });

  closeBtn.addEventListener('click', () => closeNote());

  pinBtn.addEventListener('click', () => {
    pinned = !pinned;
    updatePin();
    if (pinned) {
      clearTimeout(timers.auto);
      timers.auto = 0;
    }
  });

  note.addEventListener('pointerenter', () => {
    if (phase !== 'open') return;
    clearTimeout(timers.auto);
    timers.auto = 0;
  });

  note.addEventListener('pointerleave', () => {
    if (phase !== 'open' || pinned || !FINE_POINTER) return;
    clearTimeout(timers.auto);
    timers.auto = window.setTimeout(() => {
      if (phase === 'open' && !pinned) closeNote();
    }, CLOSE_DELAY);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (phase !== 'open' && phase !== 'opening') return;
    event.preventDefault();
    closeNote();
  });

  /* ---------- text ---------- */
  try {
    noteText.value = localStorage.getItem(TEXT_KEY) || '';
  } catch {
    noteText.value = '';
  }

  function persist() {
    clearTimeout(timers.save);
    timers.save = 0;
    try {
      localStorage.setItem(TEXT_KEY, noteText.value);
    } catch {
      /* storage may be unavailable */
    }
    dirty = false;
    saveState.classList.remove('is-saving');
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    saveText.textContent = `已保存 ${time}`;
  }

  function flushSave() {
    if (dirty || timers.save) persist();
  }

  noteText.addEventListener('input', () => {
    dirty = true;
    saveState.classList.add('is-saving');
    saveText.textContent = '保存中…';
    clearTimeout(timers.save);
    timers.save = window.setTimeout(persist, 350);
  });

  /* ---------- reset ---------- */
  resetBtn.addEventListener('click', () => {
    closeNote(true);
    clearTimeout(timers.snap);
    dragging = false;
    press = null;
    root.classList.remove('is-dragging');
    dock.classList.remove('is-handoff', 'is-returning');
    dragOrb.classList.remove('is-snapping');
    edge = 'right';
    pos = Math.round(stage.clientHeight / 2);
    placeDock();
    setPeek(false);
    updatePin();
    setTip(initialTip());
  });

  /* ---------- init / resize ---------- */
  function init() {
    if (!stage.clientWidth || !stage.clientHeight) {
      window.setTimeout(init, 40);
      return;
    }
    edge = 'right';
    pos = Math.round(stage.clientHeight / 2);
    placeDock();
    note.classList.add('is-hidden');
    updatePin();
    setTip(initialTip());
  }

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => {
      if (!stage.clientWidth) return;
      if (phase === 'open') {
        applyGeometry(computeGeometry());
      } else if (phase === 'closed') {
        placeDock();
      }
    });
    observer.observe(stage);
  }

  requestAnimationFrame(init);
})();
