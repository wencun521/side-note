import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'side-note.text';
const BALL = 58;
const OPEN_MS = 500;
const CLOSE_MS = 330;
const SAVE_DELAY = 350;
const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Phase = 'closed' | 'opening' | 'open' | 'closing';

function makeBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const diff = sampleX(t) - x;
      if (Math.abs(diff) < 1e-4) break;
      const slope = sampleDx(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= diff / slope;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}

const EASE_OPEN = makeBezier(0.4, 0, 0.2, 1);
const EASE_CLOSE = makeBezier(0.55, 0, 0.8, 0.35);

function formatTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M9.2 4h5.6l-.75 4.55 2.95 2.95H7l2.95-2.95z"
        fill={filled ? 'currentColor' : 'none'}
      />
      <path d="M12 11.5V20" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m7.5 7.5 9 9m0-9-9 9" />
    </svg>
  );
}

export default function Note() {
  const [text, setText] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinned, setPinned] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const frostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  const phaseRef = useRef<Phase>('closed');
  const scaleRef = useRef({ x: 0.15, y: 0.1 });
  const closedScaleRef = useRef({ x: 0.15, y: 0.1 });
  const rafRef = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const settledRef = useRef(false);

  const persist = useCallback((value: string) => {
    localStorage.setItem(STORAGE_KEY, value);
    setSavedAt(new Date());
    setSaving(false);
  }, []);

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    persist(textRef.current);
  }, [persist]);

  const applyScale = useCallback((x: number, y: number) => {
    scaleRef.current = { x, y };
    const surface = surfaceRef.current;
    const frost = frostRef.current;
    if (surface) surface.style.transform = `scale(${x}, ${y})`;
    if (frost) frost.style.transform = `scale(${1 / x}, ${1 / y})`;
  }, []);

  const stopMorph = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const animateTo = useCallback(
    (targetX: number, targetY: number, duration: number, ease: (t: number) => number, done: () => void) => {
      stopMorph();
      const from = scaleRef.current;
      if (duration <= 1) {
        applyScale(targetX, targetY);
        done();
        return;
      }
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = ease(progress);
        applyScale(
          from.x + (targetX - from.x) * eased,
          from.y + (targetY - from.y) * eased,
        );
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = 0;
          applyScale(targetX, targetY);
          done();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [applyScale, stopMorph],
  );

  const settle = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    rootRef.current?.classList.add('is-ready');
    window.sideNote?.settled();
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, []);

  const startClose = useCallback(() => {
    const phase = phaseRef.current;
    if (phase !== 'open' && phase !== 'opening') return;
    phaseRef.current = 'closing';
    flushSave();
    const root = rootRef.current;
    root?.classList.remove('is-open', 'is-ready');
    root?.classList.add('is-closing');
    const closed = closedScaleRef.current;
    animateTo(closed.x, closed.y, REDUCED_MOTION ? 0 : CLOSE_MS, EASE_CLOSE, () => {
      phaseRef.current = 'closed';
      window.sideNote?.closed();
    });
  }, [animateTo, flushSave]);

  const handleOpen = useCallback(
    (payload: PanelOpenPayload) => {
      const root = rootRef.current;
      if (!root) return;

      stopMorph();
      settledRef.current = false;
      phaseRef.current = 'opening';

      const closedX = BALL / payload.stageW;
      const closedY = BALL / payload.stageH;
      closedScaleRef.current = { x: closedX, y: closedY };

      root.dataset.edge = payload.edge;
      root.style.setProperty('--origin-x', `${payload.originX}px`);
      root.style.setProperty('--origin-y', `${payload.originY}px`);
      root.style.setProperty('--sx', closedX.toFixed(5));
      root.style.setProperty('--sy', closedY.toFixed(5));
      root.classList.remove('is-open', 'is-closing', 'is-ready');

      const frost = frostRef.current;
      if (frost) {
        frost.style.backgroundImage = payload.backdrop ? `url("${payload.backdrop}")` : 'none';
      }

      applyScale(closedX, closedY);
      setPinned(Boolean(payload.pinned));
      setSaving(false);
      window.sideNote?.armed();
    },
    [applyScale, stopMorph],
  );

  const handleGo = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (phaseRef.current !== 'opening') return;
        rootRef.current?.classList.add('is-open');
        animateTo(1, 1, REDUCED_MOTION ? 0 : OPEN_MS, EASE_OPEN, () => {
          if (phaseRef.current !== 'opening') return;
          phaseRef.current = 'open';
          settle();
        });
      });
    });
  }, [animateTo, settle]);

  useEffect(() => {
    const api = window.sideNote;
    if (!api) return;

    const offOpen = api.onOpen(handleOpen);
    const offGo = api.onGo(handleGo);
    const offClose = api.onClose(startClose);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      api.close();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      offOpen();
      offGo();
      offClose();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handleOpen, handleGo, startClose]);

  useEffect(() => {
    textRef.current = text;
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      persist(text);
    }, SAVE_DELAY);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [text, persist]);

  useEffect(() => {
    const onBeforeUnload = () => {
      localStorage.setItem(STORAGE_KEY, textRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    window.sideNote?.setPinned(next);
    if (next) editorRef.current?.focus();
  };

  const savingLabel = saving
    ? '保存中…'
    : savedAt
      ? `已保存 ${formatTime(savedAt)}`
      : '自动保存';

  return (
    <div className="view" ref={rootRef} data-edge="right">
      <div className="note-surface" ref={surfaceRef}>
        <div className="note-frost" ref={frostRef} aria-hidden="true" />
        <div className="note-tint" aria-hidden="true" />
      </div>
      <div className="note-content">
        <header className="note-bar">
          <div className="note-title">
            <span className="note-mark" aria-hidden="true" />
            <span>随手记</span>
          </div>
          <div className="note-tools">
            <button
              type="button"
              className={`tool${pinned ? ' is-active' : ''}`}
              onClick={togglePin}
              title={pinned ? '取消固定' : '固定便签'}
              aria-label={pinned ? '取消固定' : '固定便签'}
              aria-pressed={pinned}
            >
              <PinIcon filled={pinned} />
            </button>
            <button
              type="button"
              className="tool"
              onClick={() => window.sideNote?.close()}
              title="收起"
              aria-label="收起便签"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <textarea
          ref={editorRef}
          className="note-editor"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="随手写点什么…"
          spellCheck
          aria-label="便签内容"
        />

        <footer className="note-foot">
          <span className={`save-state${saving ? ' is-saving' : ''}`}>
            <span className="save-dot" aria-hidden="true" />
            {savingLabel}
          </span>
          <span className="note-hint">点击输入 · Esc 收起</span>
          <button
            type="button"
            className="quit"
            onClick={() => window.sideNote?.quit()}
            title="退出应用"
          >
            退出
          </button>
        </footer>
      </div>
    </div>
  );
}
