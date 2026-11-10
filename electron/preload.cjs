const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sideNote', {
  onOpen: (callback) => subscribe('panel:open', callback),
  onGo: (callback) => subscribe('panel:go', callback),
  onClose: (callback) => subscribe('panel:close', callback),
  close: () => ipcRenderer.send('panel:close-request'),
  quit: () => ipcRenderer.send('app:quit'),
  setPinned: (value) => ipcRenderer.send('panel:set-pinned', Boolean(value)),
  armed: () => ipcRenderer.send('panel:armed'),
  settled: () => ipcRenderer.send('panel:settled'),
  closed: () => ipcRenderer.send('panel:closed'),
});

contextBridge.exposeInMainWorld('sideNoteDock', {
  onLayout: (callback) => subscribe('dock:layout', callback),
  onPeek: (callback) => subscribe('dock:peek', callback),
  onGrabbed: (callback) => subscribe('dock:grabbed', callback),
  onHide: (callback) => subscribe('dock:hide', callback),
  grab: () => ipcRenderer.send('dock:grab'),
  open: () => ipcRenderer.send('dock:open'),
  snap: (edge, pos) => ipcRenderer.send('dock:snap', { edge, pos }),
  cancel: () => ipcRenderer.send('dock:cancel'),
});
