# 技术架构（ARCHITECTURE）

## 1. 技术栈与运行

- Electron 45（主进程 CommonJS）、Vite 8、React 19、TypeScript、Node 24。
- Windows 优先；依赖透明无边框窗口、`screen.getCursorScreenPoint()`、`desktopCapturer`。
- 生产构建生成两个页面：`dist/index.html`（便签）与 `dist/dock.html`（停靠层）。

```bash
npm run dev     # Vite(127.0.0.1:5173) + Electron(带 VITE_DEV_SERVER_URL)
npm run build   # vite build -> dist/
npm start       # electron .（加载 dist/）
```

`vite.config.ts` 使用 `base: './'` 和双入口；`electron/main.cjs` 通过 `VITE_DEV_SERVER_URL` 判断加载开发地址还是 `dist/`。

## 2. 进程与窗口拓扑

```
┌──────────────────────────── main.cjs ────────────────────────────┐
│ 状态机（dockEdge/dockPos/panelState/peek/pinned/backdrop）       │
│ 32ms 光标轮询 · 定时器兜底 · 截图管线 · IPC 路由                  │
└───────────────┬──────────────────────────────┬───────────────────┘
                │ IPC                          │ IPC
     ┌──────────▼──────────┐        ┌──────────▼──────────┐
     │ dock 窗口 96×96      │        │ panel 窗口 384×560   │
     │ dock.html + dock.ts  │        │ index.html + Note.tsx│
     │ 条/球/拖拽/参考线    │        │ 玻璃/形变/文本       │
     └─────────────────────┘        └─────────────────────┘
```

两个窗口的职责不能合并：

- dock 必须是一个极小的、`focusable: false`、可穿透点击的窗口，才能贴着屏幕边缘做悬停探测，不抢焦点。
- panel 需要获得焦点以输入文字，且是一个固定尺寸的“舞台”，形变全部用 CSS transform 完成，窗口本身不逐帧移动或缩放。
- 分离窗口让“球 → 便签”的交接可以先显示 panel 球、再隐藏 dock 球，避免空档。

### 窗口参数

| 参数 | dock | panel |
| --- | --- | --- |
| 尺寸 | 96×96 | 384×560（按工作区收敛） |
| `frame` / `transparent` | false / true | false / true |
| `focusable` | false | true（默认） |
| `resizable` / `movable` | false / false | false / false |
| `skipTaskbar` | true | true |
| `hasShadow` / `roundedCorners` | false / false | false / false |
| `alwaysOnTop` | `floating` | `floating` |
| 全工作区可见 | `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })` | 同左 |
| 鼠标 | `setIgnoreMouseEvents(true, { forward: true })` | 正常 |
| preload | `electron/preload.cjs` | 同左 |

`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；所有能力通过 preload 的 `contextBridge` 暴露。

## 3. 状态归属

主进程是唯一状态源；渲染层只负责呈现和手势，用事件回报生命周期。

| 状态 | 位置 | 说明 |
| --- | --- | --- |
| `dockEdge` / `dockPos` | main | 从 `userData/dock.json` 读取，吸附成功时写回 |
| `dockPeeked` / `dockDragging` / `dockVisible` / `dockIgnoring` | main | 停靠层可见性、穿透、拖拽 |
| `panelState` | main | `closed / opening / open / closing` |
| `panelArmed` / `currentPanel` / `pinned` / `panelOutsideSince` | main | 打开交接、自动收起判定 |
| `backdrop` | main | `{ key, dataUrl, at }`，见 §6 |
| 便签正文 | renderer | `localStorage`，不经主进程 |

`tick()`（32ms）负责：面板打开时判断光标是否离开并计时收起；关闭态判断条区/球区悬停、peek/unpeek、`setIgnoreMouseEvents`；空闲底图刷新。

## 4. IPC 契约

通道定义见 `electron/preload.cjs`，类型见 `src/env.d.ts`。

### dock → main

| 通道 | 载荷 | 行为 |
| --- | --- | --- |
| `dock:open` | 无 | 打开面板（仅 `closed` 时） |
| `dock:grab` | 无 | 开始拖拽：窗口扩展到工作区、关闭穿透、清空底图 key |
| `dock:snap` | `{ edge, pos }` | 吸附：持久化、恢复 96×96、刷新底图 |
| `dock:cancel` | 无 | 取消拖拽，保持原位置 |

### main → dock

| 通道 | 载荷 | 行为 |
| --- | --- | --- |
| `dock:layout` | `{ edge, peek, hidden, returning?, snapped?, returned? }` | 同步边、peek、隐藏与动画标记 |
| `dock:peek` | `boolean` | 单独切换 peek |
| `dock:grabbed` | `{ x, y, width, height }` | 拖拽层可用区域（工作区），渲染层重新捕获指针 |
| `dock:hide` | 无 | 面板接管，隐藏 dock 内容 |

### main ↔ panel

| 通道 | 方向 | 载荷 | 行为 |
| --- | --- | --- | --- |
| `panel:open` | main → panel | `{ edge, originX, originY, stageW, stageH, pinned, backdrop }` | 设置关闭态 scale、原点、底图；随后回报 `panel:armed` |
| `panel:armed` | panel → main | 无 | 关闭态已应用，可显示窗口（260ms 兜底） |
| `panel:go` | main → panel | 无 | 双 rAF 后开始 500ms 形变 |
| `panel:settled` | panel → main | 无 | 形变完成，标记 open（1200ms 兜底） |
| `panel:close` | main → panel | 无 | 开始 330ms 收起 |
| `panel:closed` | panel → main | 无 | 收起完成，隐藏面板、dock 回归（900ms 兜底） |
| `panel:close-request` | panel → main | 无 | Esc / 关闭按钮 |
| `panel:set-pinned` | panel → main | `boolean` | 固定后不自动收起 |
| `app:quit` | panel → main | 无 | 退出应用 |

## 5. 关键时序

### 5.1 打开

```
renderer click → dock:open
main: state=opening；计算几何；panel.setBounds（隐藏窗口）
      send panel:open（含缓存底图，不等待截图）
renderer: 应用关闭态 scale + 原点 + 底图；send panel:armed
main: panel.show() + moveTop() + send panel:go
      立即 send dock:hide；90ms 后 dock.hide()
renderer: 双 rAF 后 is-open + 500ms 形变
      完成后 is-ready + 聚焦 + send panel:settled
main: state=open
```

关键点：`open` 路径上没有任何 `await`；截图链路完全在后台。

### 5.2 关闭

```
光标离开面板 1000ms（未固定）或 Esc
main: state=closing；send panel:close
renderer: 移除 is-ready/is-open，330ms 缩回原点；send panel:closed
main: panel.hide()；dock 回归；send dock:layout { returning: true }
```

### 5.3 拖拽

```
pointerdown（只记录起点，不 grab）
pointermove ≥5px → dock:grab（此刻才扩展窗口）
main: 窗口=工作区、关闭穿透、send dock:grabbed(area)
renderer: 添加 is-dragging/is-grabbing；用 area 放置拖拽球
pointerup：渲染层 240ms 移动动画 → dock:snap { edge, pos }
main: 写 dock.json、恢复小窗口、刷新底图、send dock:layout { snapped: true }
```

## 6. 截图毛玻璃管线

```
desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display/4 })
  → 按 display_id 选屏幕
  → 缩略图坐标 = (panelRect - display.bounds) * (thumb / display.bounds)
  → nativeImage.crop → toDataURL()
```

- 结果按 `edge:pos:分辨率` 作为 key 缓存，记录 `at` 时间。
- `refreshBackdrop()` 用 `backdropPending` 去重，和 900ms 超时竞速；失败返回空串。
- 触发时机：空闲轮询（面板关闭、未 peek、未拖拽，距上次 ≥6s）、`dock:snap` 后、显示器变化时清空。
- 打开时只读取 `cachedBackdrop()`，**绝不 await**；为空时便签显示纯色玻璃。
- 捕获期间 dock 条本身可能被拍进底图，但会被 8px 模糊且位于贴边区域，可接受。

## 7. 坐标与 DPI

- Electron 的 `screen`、`workArea`、`setBounds`、`getCursorScreenPoint()` 全部使用 DIP。
- 渲染层取屏幕坐标统一用 `event.clientX + window.screenX`，不要用 `event.screenX`：窗口扩展/缩放后它会漂移。
- `pointerup` 必须用自身事件的坐标计算终点，不能复用最后一次 move。
- 拖拽时调用了 `setPointerCapture`；窗口扩展会打断捕获，因此 `dock:grabbed` 到达后要在 `documentElement` 上重新捕获。
- 自动化测试注意：DPI 125% 下 DPI-unaware 的 PowerShell `SetCursorPos` 使用 DIP 坐标；悬浮球球心在距屏幕边缘 39px 处，而触发 peek 的条区只有 30px，所以“直接移动鼠标到球上”不会弹出，必须先悬停条区。

## 8. 兜底策略

渲染层可能因 rAF 暂停、页面重载或异常漏发事件，主进程必须有超时推进：

| 定时器 | 时长 | 作用 |
| --- | --- | --- |
| `openSafety` | 260ms | 未收到 `panel:armed` 也显示面板 |
| `openSettle` | 1200ms | 未收到 `panel:settled` 也标记 open |
| `closeSafety` | 900ms | 未收到 `panel:closed` 也完成关闭 |
| `dockHideTimer` | 90ms | 面板显示后隐藏 dock 窗口 |
| `dragSafety` | 6000ms | 拖拽失联时恢复停靠 |
| 捕获超时 | 900ms | 后台截图失败不阻塞 |

新增异步步骤时必须同时设计兜底，否则应用可能停在中间状态（dock 不可点、面板不收起）。

## 9. 单实例与退出

- `app.requestSingleInstanceLock()`；第二次启动若面板已关闭则直接打开，否则忽略。
- 关闭按钮不退出应用；`app:quit` 设置 `isQuitting` 后 `app.quit()`；两个窗口的 `close` 事件在非退出时被拦截。
- `will-quit` 清除轮询定时器。

## 10. 验证方法（当前没有自动化测试）

1. 构建：`npm run build`。
2. 调试启动：`npx electron . --remote-debugging-port=9222`，`http://127.0.0.1:9222/json/list` 可拿到两个页面 target。
3. 几何检查：在页面里 `Runtime.evaluate` 读取 `screenX / screenY / outerWidth / outerHeight`。
4. 形变检查：对 `.note-surface` 挂 `MutationObserver` 记录 `style.transform` 与时间戳，确认 scale 单调从 58/stage 到 1，约 500ms。
5. 点击/拖动：用 PowerShell `SetCursorPos` + `mouse_event`（先条区后球心），或计算机控制工具。
6. 录屏：`ffmpeg -f gdigrab -framerate 30 -video_size 1920x1080 -i desktop -t 3 out.mp4`，抽帧检查球是否消失、是否白底、是否二次弹出。
7. 状态：`%APPDATA%/side-note/dock.json` 验证吸附；重启验证文字。

临时计时日志（如 `console.log('[timing] ...')`）只用于验证，提交前删除。本机实测：点击 → `panel:open` 0.3–1ms，点击 → 窗口显示 9–19ms；点击时 dock 窗口保持 96×96。

## 11. 已知限制与扩展点

- 仅使用主显示器（`screen.getPrimaryDisplay()`）；多屏需把 dock 所在显示器纳入状态与几何计算。
- 单便签；正文存在 `localStorage`（按 Electron userData 隔离）。
- 底图最多旧 6s；对静态桌面无感，对视频会定格。
- 未做打包、托盘、开机自启；`electron-builder` 或 Electron Forge 可直接接在现有 `main` 入口上。
- 停靠层固定 Windows 视觉假设（Segoe UI、DWM 透明窗口），跨平台需重做窗口级策略。
