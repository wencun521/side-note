/// <reference types="vite/client" />

type DockEdge = 'top' | 'right' | 'bottom' | 'left';

interface PanelOpenPayload {
  edge: DockEdge;
  originX: number;
  originY: number;
  stageW: number;
  stageH: number;
  pinned: boolean;
  backdrop?: string;
}

interface SideNoteApi {
  onOpen(callback: (payload: PanelOpenPayload) => void): () => void;
  onGo(callback: () => void): () => void;
  onClose(callback: () => void): () => void;
  close(): void;
  quit(): void;
  setPinned(value: boolean): void;
  armed(): void;
  settled(): void;
  closed(): void;
}

interface DockLayout {
  edge: DockEdge;
  peek: boolean;
  hidden: boolean;
  snapped?: boolean;
  returning?: boolean;
}

interface DockArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DockApi {
  onLayout(callback: (layout: DockLayout) => void): () => void;
  onPeek(callback: (peek: boolean) => void): () => void;
  onGrabbed(callback: (area: DockArea) => void): () => void;
  onHide(callback: () => void): () => void;
  grab(): void;
  open(): void;
  snap(edge: DockEdge, pos: number): void;
  cancel(): void;
}

interface Window {
  sideNote?: SideNoteApi;
  sideNoteDock?: DockApi;
}
