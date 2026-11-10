const api = window.sideNoteDock;
const root = document.getElementById('dockRoot')!;
const hit = document.getElementById('dockHit') as HTMLButtonElement;
const orb = document.getElementById('dragOrb') as HTMLDivElement;
const guides = Array.from(document.querySelectorAll<HTMLElement>('.guide'));

const BALL_EDGE = 39;
const EDGE_CLAMP = 58;
const DRAG_THRESHOLD = 5;
const SNAP_MS = 240;

let area: DockArea = { x: 0, y: 0, width: 0, height: 0 };
let areaReady = false;
let press: { x: number; y: number } | null = null;
let dragging = false;
let screenPointer = { x: 0, y: 0 };
let activePointer: number | null = null;
let snapTimer: number | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function setEdge(edge: DockEdge) {
  root.dataset.edge = edge;
}

function eventScreenPoint(event: PointerEvent) {
  return {
    x: event.clientX + window.screenX,
    y: event.clientY + window.screenY,
  };
}

function relativePointer() {
  return {
    x: screenPointer.x - area.x,
    y: screenPointer.y - area.y,
  };
}

function nearestEdge(point: { x: number; y: number }): DockEdge {
  const distances: Array<[DockEdge, number]> = [
    ['left', point.x],
    ['right', area.width - point.x],
    ['top', point.y],
    ['bottom', area.height - point.y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function snapPosition(edge: DockEdge, point: { x: number; y: number }) {
  const length = edge === 'top' || edge === 'bottom' ? area.width : area.height;
  const along = edge === 'top' || edge === 'bottom' ? point.x : point.y;
  const max = Math.max(EDGE_CLAMP, length - EDGE_CLAMP);
  return Math.round(clamp(along, EDGE_CLAMP, max));
}

function snapPoint(edge: DockEdge, pos: number) {
  if (edge === 'left') return { x: BALL_EDGE, y: pos };
  if (edge === 'right') return { x: area.width - BALL_EDGE, y: pos };
  if (edge === 'top') return { x: pos, y: BALL_EDGE };
  return { x: pos, y: area.height - BALL_EDGE };
}

function placeOrb() {
  if (!areaReady) return;
  const point = relativePointer();
  orb.style.left = `${point.x}px`;
  orb.style.top = `${point.y}px`;
}

function setGuide(edge: DockEdge | null) {
  guides.forEach((guide) => {
    guide.classList.toggle('is-active', guide.dataset.edge === edge);
  });
}

function updateGuides() {
  const point = relativePointer();
  setGuide(nearestEdge(point));
}

function addListeners() {
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onCancel);
}

function removeListeners() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('blur', onCancel);
}

function resetDragVisuals() {
  if (snapTimer) {
    clearTimeout(snapTimer);
    snapTimer = null;
  }
  orb.classList.remove('is-snapping');
  orb.style.left = '-200px';
  orb.style.top = '-200px';
  orb.style.opacity = '';
  orb.style.transform = '';
  setGuide(null);
  root.classList.remove('is-dragging', 'is-grabbing', 'is-releasing');
}

function releasePress() {
  if (activePointer !== null && hit.hasPointerCapture?.(activePointer)) {
    hit.releasePointerCapture(activePointer);
  }
  activePointer = null;
  press = null;
  removeListeners();
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || press) return;
  event.preventDefault();
  screenPointer = eventScreenPoint(event);
  press = { ...screenPointer };
  activePointer = event.pointerId;
  try {
    hit.setPointerCapture(event.pointerId);
  } catch {
    // pointer capture is a best-effort safeguard
  }
  addListeners();
}

function onMove(event: PointerEvent) {
  if (!press) return;
  screenPointer = eventScreenPoint(event);
  const dx = screenPointer.x - press.x;
  const dy = screenPointer.y - press.y;

  if (!dragging) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragging = true;
    api?.grab();
    return;
  }

  placeOrb();
  updateGuides();
}

function onUp(event: PointerEvent) {
  if (!press) return;
  screenPointer = eventScreenPoint(event);
  releasePress();

  if (!dragging) {
    api?.open();
    return;
  }

  const point = relativePointer();
  const edge = nearestEdge(point);
  const pos = snapPosition(edge, point);
  const target = snapPoint(edge, pos);

  root.classList.add('is-releasing');
  setGuide(null);
  orb.classList.add('is-snapping');
  orb.style.left = `${target.x}px`;
  orb.style.top = `${target.y}px`;
  orb.style.transform = 'translate(-50%, -50%) scale(0.86)';
  orb.style.opacity = '0';

  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = window.setTimeout(() => {
    snapTimer = null;
    api?.snap(edge, pos);
  }, SNAP_MS);
}

function onCancel() {
  if (!press) return;
  releasePress();
  dragging = false;
  resetDragVisuals();
  api?.cancel();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !press) return;
  event.preventDefault();
  onCancel();
}

function pulse(className: string) {
  root.classList.add(className);
  window.setTimeout(() => root.classList.remove(className), 430);
}

hit.addEventListener('pointerdown', onPointerDown);

api?.onLayout((layout) => {
  if (layout.edge) setEdge(layout.edge);
  root.classList.toggle('is-peek', Boolean(layout.peek));
  root.classList.toggle('is-hidden', Boolean(layout.hidden));

  if (!layout.hidden) {
    releasePress();
    dragging = false;
    resetDragVisuals();
  } else {
    dragging = false;
    resetDragVisuals();
  }

  if (layout.snapped) pulse('is-snapped');
  if (layout.returning) pulse('is-returning');
});

api?.onPeek((peek) => {
  root.classList.toggle('is-peek', Boolean(peek));
});

api?.onHide(() => {
  root.classList.add('is-hidden');
  releasePress();
  dragging = false;
  resetDragVisuals();
});

api?.onGrabbed((next) => {
  area = next;
  areaReady = true;
  if (activePointer !== null) {
    try {
      document.documentElement.setPointerCapture(activePointer);
    } catch {
      // the capture may already be held by the original element
    }
  }
  if (dragging) {
    root.classList.add('is-dragging', 'is-grabbing');
    placeOrb();
    updateGuides();
  }
});
