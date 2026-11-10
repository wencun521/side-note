const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, screen, ipcMain, desktopCapturer } = require('electron');

const BALL = 58;
const BALL_GAP = 10;
const DOCK_SIZE = 96;
const DOCK_HALF = DOCK_SIZE / 2;
const DOCK_MARGIN = 10;
const PEEK_THICKNESS = 30;
const PEEK_HALF_LENGTH = 44;
const BALL_THICKNESS = BALL_GAP + BALL + 8;
const PANEL_WIDTH = 384;
const PANEL_HEIGHT = 560;
const PANEL_MARGIN = 10;
const POLL_MS = 32;
const PEEK_DELAY = 60;
const UNPEEK_DELAY = 220;
const CLOSE_DELAY = 1000;
const CLOSE_FALLBACK_MS = 900;
const OPEN_FALLBACK_MS = 1200;
const IDLE_BACKDROP_MS = 6000;

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const dockStorePath = () => path.join(app.getPath('userData'), 'dock.json');

let dock = null;
let panel = null;
let dockReady = false;
let panelReady = false;

let dockEdge = 'right';
let dockPos = 0;
let dockPeeked = false;
let dockDragging = false;
let dockVisible = true;
let dockIgnoring = true;

let panelState = 'closed';
let panelArmed = false;
let currentPanel = null;
let pinned = false;
let panelOutsideSince = 0;
let dockInsideSince = 0;
let dockOutsideSince = 0;

let pollTimer = null;
let openSafety = null;
let openSettle = null;
let closeSafety = null;
let dockHideTimer = null;
let dragSafety = null;
let isQuitting = false;

let backdrop = { key: '', dataUrl: '', at: 0 };
let backdropPending = null;
let backdropTryAt = 0;

const EDGES = new Set(['top', 'right', 'bottom', 'left']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function edgeLength(wa) {
  return dockEdge === 'top' || dockEdge === 'bottom' ? wa.width : wa.height;
}

function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function loadPage(win, page) {
  if (devServerUrl) {
    win.loadURL(`${devServerUrl}/${page}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', page));
  }
}

function readDockState() {
  try {
    const saved = JSON.parse(fs.readFileSync(dockStorePath(), 'utf8'));
    if (EDGES.has(saved.edge) && Number.isFinite(saved.pos)) {
      dockEdge = saved.edge;
      dockPos = saved.pos;
      return;
    }
  } catch {
    // first run or unreadable file
  }
  const wa = workArea();
  dockEdge = 'right';
  dockPos = wa.y + wa.height / 2;
}

function saveDockState() {
  try {
    fs.writeFileSync(dockStorePath(), JSON.stringify({ edge: dockEdge, pos: dockPos }));
  } catch (error) {
    console.warn('Unable to save dock position:', error.message);
  }
}

function clampDockPos(wa) {
  const min = DOCK_HALF + DOCK_MARGIN;
  const max = edgeLength(wa) - DOCK_HALF - DOCK_MARGIN;
  dockPos = Math.round(clamp(dockPos, min, Math.max(min, max)));
}

function dockWindowBounds(wa) {
  if (dockEdge === 'right' || dockEdge === 'left') {
    return {
      x: Math.round(dockEdge === 'right' ? wa.x + wa.width - DOCK_SIZE : wa.x),
      y: Math.round(wa.y + dockPos - DOCK_HALF),
      width: DOCK_SIZE,
      height: DOCK_SIZE,
    };
  }
  return {
    x: Math.round(wa.x + dockPos - DOCK_HALF),
    y: Math.round(dockEdge === 'top' ? wa.y : wa.y + wa.height - DOCK_SIZE),
    width: DOCK_SIZE,
    height: DOCK_SIZE,
  };
}

function panelGeometry(wa) {
  const stageW = Math.min(PANEL_WIDTH, Math.max(280, wa.width - PANEL_MARGIN * 2));
  const stageH = Math.min(PANEL_HEIGHT, Math.max(280, wa.height - PANEL_MARGIN * 2));
  const half = BALL / 2;
  const along = clamp(dockPos, half + PANEL_MARGIN, edgeLength(wa) - half - PANEL_MARGIN);
  let x;
  let y;
  let originX;
  let originY;

  if (dockEdge === 'right' || dockEdge === 'left') {
    y = wa.y + clamp(along - stageH / 2, PANEL_MARGIN, wa.height - stageH - PANEL_MARGIN);
    x = dockEdge === 'right' ? wa.x + wa.width - stageW : wa.x;
    originX = dockEdge === 'right' ? stageW - half - BALL_GAP : half + BALL_GAP;
    originY = along - (y - wa.y);
  } else {
    x = wa.x + clamp(along - stageW / 2, PANEL_MARGIN, wa.width - stageW - PANEL_MARGIN);
    y = dockEdge === 'top' ? wa.y : wa.y + wa.height - stageH;
    originX = along - (x - wa.x);
    originY = dockEdge === 'top' ? half + BALL_GAP : stageH - half - BALL_GAP;
  }

  return { x: Math.round(x), y: Math.round(y), width: stageW, height: stageH, originX, originY };
}

function inDockZone(point, wa, thickness, halfLength) {
  const along = dockEdge === 'top' || dockEdge === 'bottom' ? point.x - wa.x : point.y - wa.y;
  if (Math.abs(along - dockPos) > halfLength) return false;
  if (dockEdge === 'right') {
    const inward = wa.x + wa.width - point.x;
    return inward >= -1 && inward <= thickness;
  }
  if (dockEdge === 'left') {
    const inward = point.x - wa.x;
    return inward >= -1 && inward <= thickness;
  }
  if (dockEdge === 'top') {
    const inward = point.y - wa.y;
    return inward >= -1 && inward <= thickness;
  }
  const inward = wa.y + wa.height - point.y;
  return inward >= -1 && inward <= thickness;
}

function backdropKey(wa) {
  return `${dockEdge}:${Math.round(dockPos)}:${wa.width}x${wa.height}`;
}

async function captureBackdrop(display) {
  const wa = display.workArea;
  const geo = panelGeometry(wa);
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.bounds.width / 4),
        height: Math.round(display.bounds.height / 4),
      },
      fetchWindowIcons: false,
    });
    if (!sources.length) return '';
    const source =
      sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
    const thumb = source.thumbnail;
    const size = thumb.getSize();
    if (!size.width || !size.height) return '';

    const scaleX = size.width / display.bounds.width;
    const scaleY = size.height / display.bounds.height;
    const x = Math.max(0, Math.round((geo.x - display.bounds.x) * scaleX));
    const y = Math.max(0, Math.round((geo.y - display.bounds.y) * scaleY));
    const width = Math.max(1, Math.min(size.width - x, Math.round(geo.width * scaleX)));
    const height = Math.max(1, Math.min(size.height - y, Math.round(geo.height * scaleY)));
    return thumb.crop({ x, y, width, height }).toDataURL();
  } catch (error) {
    console.warn('Backdrop capture failed:', error.message);
    return '';
  }
}

function refreshBackdrop(display) {
  if (!display) return Promise.resolve('');
  if (backdropPending) return backdropPending;
  const key = backdropKey(display.workArea);
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve('__timeout__'), 900);
  });
  backdropPending = Promise.race([captureBackdrop(display), timeout])
    .then((dataUrl) => {
      if (dataUrl && dataUrl !== '__timeout__') {
        backdrop = { key, dataUrl, at: Date.now() };
        return dataUrl;
      }
      return '';
    })
    .finally(() => {
      backdropPending = null;
    });
  return backdropPending;
}

function cachedBackdrop() {
  return backdrop.dataUrl || '';
}

function setDockPeek(next) {
  if (dockPeeked === next) return;
  dockPeeked = next;
  if (!next) dockOutsideSince = 0;
  if (dock && dockReady) dock.webContents.send('dock:peek', next);
}

function sendDockLayout(extra = {}) {
  if (!dock || !dockReady) return;
  dock.webContents.send('dock:layout', {
    edge: dockEdge,
    peek: dockPeeked,
    hidden: !dockVisible || panelState !== 'closed' || dockDragging,
    ...extra,
  });
}

function updateDockIgnore(ignore) {
  if (!dock || ignore === dockIgnoring) return;
  dockIgnoring = ignore;
  dock.setIgnoreMouseEvents(ignore, { forward: true });
}

function clearDragSafety() {
  if (dragSafety) {
    clearTimeout(dragSafety);
    dragSafety = null;
  }
}

function positionDock() {
  if (!dock) return;
  const wa = workArea();
  clampDockPos(wa);
  dock.setBounds(dockWindowBounds(wa));
}

function createDock() {
  const wa = workArea();
  clampDockPos(wa);
  const bounds = dockWindowBounds(wa);

  dock = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  dock.setAlwaysOnTop(true, 'floating');
  dock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dock.setIgnoreMouseEvents(true, { forward: true });
  loadPage(dock, 'dock.html');

  dock.webContents.on('did-finish-load', () => {
    dockReady = true;
    positionDock();
    sendDockLayout({ returning: true });
    if (dock) dock.showInactive();
  });

  dock.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
  });

  if (devServerUrl) {
    dock.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        dock.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
}

function createPanel() {
  const wa = workArea();
  panel = new BrowserWindow({
    width: Math.min(PANEL_WIDTH, wa.width - PANEL_MARGIN * 2),
    height: Math.min(PANEL_HEIGHT, wa.height - PANEL_MARGIN * 2),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  panel.setAlwaysOnTop(true, 'floating');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadPage(panel, 'index.html');

  panel.webContents.on('did-finish-load', () => {
    panelReady = true;
  });

  panel.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    requestClose();
  });

  if (devServerUrl) {
    panel.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        panel.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
}

function openPanelFromDock() {
  if (!panel || !panelReady || panelState !== 'closed') return;

  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  clampDockPos(wa);
  const geo = panelGeometry(wa);
  currentPanel = geo;
  panelState = 'opening';
  panelArmed = false;
  dockDragging = false;
  pinned = false;
  panelOutsideSince = 0;

  panel.setBounds({ x: geo.x, y: geo.y, width: geo.width, height: geo.height });
  panel.webContents.send('panel:open', {
    edge: dockEdge,
    originX: geo.originX,
    originY: geo.originY,
    stageW: geo.width,
    stageH: geo.height,
    pinned: false,
    backdrop: cachedBackdrop(),
  });

  if (openSafety) clearTimeout(openSafety);
  openSafety = setTimeout(() => {
    openSafety = null;
    armPanel();
  }, 260);
}

function hideDockForPanel() {
  dockVisible = false;
  dockDragging = false;
  setDockPeek(false);
  if (dock && dockReady) dock.webContents.send('dock:hide');
  if (dockHideTimer) clearTimeout(dockHideTimer);
  dockHideTimer = setTimeout(() => {
    dockHideTimer = null;
    if (panelState !== 'closed' && dock) dock.hide();
  }, 90);
}

function armPanel() {
  if (panelState !== 'opening' || !panel) return;
  if (openSafety) {
    clearTimeout(openSafety);
    openSafety = null;
  }
  panelArmed = true;
  panel.show();
  panel.moveTop();
  panel.webContents.send('panel:go');
  hideDockForPanel();

  if (openSettle) clearTimeout(openSettle);
  openSettle = setTimeout(() => {
    openSettle = null;
    if (panelState === 'opening') markPanelOpen();
  }, OPEN_FALLBACK_MS);
}

function markPanelOpen() {
  clearOpenTimers();
  if (panelState !== 'opening') return;
  panelState = 'open';
  panelOutsideSince = 0;
}

function clearOpenTimers() {
  if (openSafety) {
    clearTimeout(openSafety);
    openSafety = null;
  }
  if (openSettle) {
    clearTimeout(openSettle);
    openSettle = null;
  }
}

function requestClose() {
  if (!panel) return;
  if (panelState !== 'open' && panelState !== 'opening') return;

  clearOpenTimers();
  panelState = 'closing';
  panelOutsideSince = 0;
  pinned = false;
  panel.webContents.send('panel:close');

  if (closeSafety) clearTimeout(closeSafety);
  closeSafety = setTimeout(() => {
    closeSafety = null;
    finishClose();
  }, CLOSE_FALLBACK_MS);
}

function finishClose() {
  if (panelState !== 'closing') return;
  if (closeSafety) {
    clearTimeout(closeSafety);
    closeSafety = null;
  }
  if (panel) panel.hide();
  panelState = 'closed';
  panelArmed = false;
  currentPanel = null;
  dockVisible = true;
  positionDock();
  setDockPeek(false);
  if (dock) {
    dock.showInactive();
    sendDockLayout({ returning: true });
  }
}

function tick() {
  if (!dock || !panel || !dockReady) return;

  const now = Date.now();
  const point = screen.getCursorScreenPoint();
  const wa = workArea();

  if (panelState === 'open' || panelState === 'opening') {
    if (pinned || (currentPanel && pointInRect(point, currentPanel))) {
      panelOutsideSince = 0;
    } else if (!panelOutsideSince) {
      panelOutsideSince = now;
    } else if (now - panelOutsideSince >= CLOSE_DELAY) {
      requestClose();
    }
    if (panelState !== 'closing') updateDockIgnore(true);
    return;
  }

  if (panelState === 'closing') {
    updateDockIgnore(true);
    return;
  }

  if (dockDragging) {
    updateDockIgnore(false);
    return;
  }

  const nearBar = inDockZone(point, wa, PEEK_THICKNESS, PEEK_HALF_LENGTH);
  const nearBall = dockPeeked && inDockZone(point, wa, BALL_THICKNESS, PEEK_HALF_LENGTH);

  if (!dockPeeked && !nearBar && now - backdrop.at > IDLE_BACKDROP_MS && now - backdropTryAt > IDLE_BACKDROP_MS) {
    backdropTryAt = now;
    refreshBackdrop(screen.getPrimaryDisplay());
  }

  if (nearBar && !dockPeeked) {
    if (!dockInsideSince) dockInsideSince = now;
    if (now - dockInsideSince >= PEEK_DELAY) {
      dockInsideSince = 0;
      setDockPeek(true);
    }
  } else {
    dockInsideSince = 0;
  }

  if (dockPeeked) {
    if (!nearBar && !nearBall) {
      if (!dockOutsideSince) dockOutsideSince = now;
      if (now - dockOutsideSince >= UNPEEK_DELAY) {
        dockOutsideSince = 0;
        setDockPeek(false);
      }
    } else {
      dockOutsideSince = 0;
    }
  } else {
    dockOutsideSince = 0;
  }

  updateDockIgnore(dockPeeked ? !nearBar && !nearBall : !nearBar);
}

ipcMain.on('panel:armed', () => {
  if (panelState === 'opening' && !panelArmed) armPanel();
});

ipcMain.on('panel:settled', () => {
  if (panelState === 'opening') markPanelOpen();
});

ipcMain.on('panel:closed', () => {
  if (panelState === 'closing') finishClose();
});

ipcMain.on('panel:close-request', () => {
  requestClose();
});

ipcMain.on('panel:set-pinned', (_event, value) => {
  pinned = Boolean(value);
  if (!pinned && panelState === 'open') {
    const point = screen.getCursorScreenPoint();
    if (!currentPanel || !pointInRect(point, currentPanel)) panelOutsideSince = Date.now();
  }
});

ipcMain.on('dock:open', () => {
  if (panelState !== 'closed') return;
  clearDragSafety();
  dockDragging = false;
  openPanelFromDock();
});

ipcMain.on('dock:grab', () => {
  if (!dock || !dockReady || dockDragging || panelState !== 'closed') return;
  dockDragging = true;
  backdrop = { ...backdrop, key: '' };
  setDockPeek(false);
  dockVisible = true;
  const wa = workArea();
  dock.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
  dock.setIgnoreMouseEvents(false);
  dockIgnoring = false;
  dock.webContents.send('dock:grabbed', {
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
  });

  clearDragSafety();
  dragSafety = setTimeout(() => {
    dragSafety = null;
    if (!dockDragging) return;
    dockDragging = false;
    positionDock();
    if (dock) {
      dock.setIgnoreMouseEvents(true, { forward: true });
      dockIgnoring = true;
      sendDockLayout({ returned: true });
    }
  }, 6000);
});

ipcMain.on('dock:snap', (_event, payload) => {
  if (!dock || !dockReady) return;
  clearDragSafety();
  const edge = payload && payload.edge;
  const pos = payload && payload.pos;
  if (EDGES.has(edge) && Number.isFinite(pos)) {
    dockEdge = edge;
    dockPos = pos;
    clampDockPos(workArea());
    backdrop = { ...backdrop, key: '' };
    saveDockState();
  }
  dockDragging = false;
  positionDock();
  dock.setIgnoreMouseEvents(true, { forward: true });
  dockIgnoring = true;
  sendDockLayout({ snapped: true });
  refreshBackdrop(screen.getPrimaryDisplay());
});

ipcMain.on('dock:cancel', () => {
  if (!dock || !dockReady) return;
  clearDragSafety();
  dockDragging = false;
  positionDock();
  dock.setIgnoreMouseEvents(true, { forward: true });
  dockIgnoring = true;
  sendDockLayout({ returned: true });
});

ipcMain.on('app:quit', () => {
  isQuitting = true;
  app.quit();
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (panelState !== 'closed') return;
    openPanelFromDock();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    readDockState();
    createDock();
    createPanel();
    pollTimer = setInterval(tick, POLL_MS);

    screen.on('display-metrics-changed', () => {
      backdrop = { ...backdrop, key: '' };
      if (dock && panelState === 'closed' && !dockDragging) {
        positionDock();
        sendDockLayout();
      }
    });

    screen.on('display-removed', () => {
      backdrop = { ...backdrop, key: '' };
      if (panelState !== 'closed') requestClose();
      if (dock && !dockDragging) {
        positionDock();
        sendDockLayout();
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
  });
}
