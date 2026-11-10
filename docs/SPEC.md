# 功能规格（SPEC）

本文件是行为的唯一事实来源。任何交互、时序或尺寸变更，先改这里，再改实现。

## 1. 产品目标

1. 不占桌面：默认只是一条贴边的玻璃小条（22×88 px）。
2. 一步可达：悬停出球，点击出便签，收回无需确认。
3. 视觉连续：便签必须从悬浮球的位置“生长”出来，不允许闪现白底、直角或第二个窗口。
4. 常驻可靠：拖动可换边，位置与文字重启后仍在。

非目标（当前版本不做）：富文本、多便签、多显示器、云同步、安装包、托盘、开机自启、全局快捷键。

## 2. 核心概念

| 概念 | 说明 |
| --- | --- |
| 停靠层 dock | 独立的小窗口（96×96 DIP），显示玻璃条、悬浮球、拖拽球和吸附参考线 |
| 便签层 panel | 独立窗口（384×560 DIP），显示毛玻璃便签；展开时舞台尺寸不变，用 CSS transform 形变 |
| peek | 悬停玻璃条后弹出悬浮球的中间态 |
| 边 dockEdge | `top` / `right` / `bottom` / `left`，默认 `right` |
| 位置 dockPos | 沿停靠边的中心坐标（DIP），说明见 §4.1 |
| 展开原点 origin | 便签窗口内对应悬浮球球心的坐标，形变以它为原点 |

## 3. 交互状态机

### 3.1 停靠层

```
bar（玻璃条）
  └─ 悬停条区 60ms ──▶ peek（悬浮球）
peek
  ├─ 离开条区与球区 220ms ──▶ bar
  ├─ 按住并移动 ≥5px ──▶ dragging
  └─ 点击（位移 <5px）──▶ open（面板打开，dock 隐藏）
dragging
  ├─ 松开 ──▶ 最近边吸附（240ms 动画）──▶ bar
  ├─ pointercancel ──▶ bar（保持原位置）
  └─ 6s 主进程兜底 ──▶ bar
open
  └─ 面板关闭完成 ──▶ bar（带 returning 弹入动画）
```

规则：

- 点击判定与拖拽判定互斥：按下后移动小于 5px 视为点击，松手即打开；达到 5px 立即进入拖拽。
- **点击不得改变 dock 窗口尺寸**，也不得让悬浮球消失（历史 bug，见 AGENTS.md）。
- 悬停只触发 peek，不触发任何截图或窗口移动。
- 拖拽时 dock 窗口临时扩展到整个工作区，用于接收全屏指针；松手后立即恢复 96×96。
- 吸附取“距离最近”的边，不按拖动方向；吸附点在边上限制在距两端 58px 以内。
- 拖拽位置只在吸附成功时写盘。

### 3.2 便签层

```
closed
  └─ dock:open / 第二次启动 ──▶ opening（立即，无等待）
opening
  ├─ renderer 回报 armed ──▶ 显示窗口 + 发送 go
  ├─ go 后双 rAF ──▶ 形变 500ms ──▶ settled（内容淡入、聚焦）
  ├─ settled 或 1200ms 兜底 ──▶ open
  └─ close 请求 ──▶ closing
open
  ├─ 光标离开面板矩形 1000ms（未固定）──▶ closing
  ├─ Esc / 关闭按钮 ──▶ closing
  └─ 固定（pin）──▶ 不自动收起
closing
  ├─ 形变 330ms 结束 ──▶ closed（隐藏面板、dock 回归）
  └─ 900ms 兜底 ──▶ closed
```

- 打开过程不等待任何截图；玻璃底图使用空闲时缓存，见 §8。
- 面板显示后 90ms 才隐藏 dock 悬浮球，保证球到便签的交接无空档。
- 内容层只在玻璃完全落位后可见（`is-ready`），避免文字露出圆角外。
- `opening` / `closing` 期间不接受新的打开请求。
- 固定状态不持久化：每次打开、关闭都重置为未固定。

## 4. 几何规格（全部为 DIP 逻辑像素）

### 4.1 常量

| 名称 | 值 | 含义 |
| --- | --- | --- |
| BALL | 58 | 悬浮球直径 |
| BALL_GAP | 10 | 球与屏幕边缘的间距 |
| DOCK_SIZE | 96 | dock 窗口边长 |
| DOCK_MARGIN | 10 | 吸附点距边两端的最小距离 |
| PEEK_THICKNESS | 30 | 触发 peek 的条区厚度 |
| PEEK_HALF_LENGTH | 44 | 条区/球区沿边的半长 |
| BALL_THICKNESS | 76 | peek 后保持展开的球区厚度 |
| PANEL_WIDTH / HEIGHT | 384 / 560 | 便签舞台尺寸 |
| PANEL_MARGIN | 10 | 面板距工作区边的最小距离 |
| POLL_MS | 32 | 主进程光标轮询间隔 |

`dockPos` 是球心沿边的坐标（绝对 DIP）；窗口/条区位置由它推导。

### 4.2 dock 窗口

| 边 | 窗口位置 | 说明 |
| --- | --- | --- |
| right | x = wa.right − 96，y = wa.y + dockPos − 48 | 球心距屏幕右缘 10 + 29 = 39 |
| left | x = wa.x，y = wa.y + dockPos − 48 | 球心距屏幕左缘 39 |
| top | x = wa.x + dockPos − 48，y = wa.y | 球心距屏幕上缘 39 |
| bottom | x = wa.x + dockPos − 48，y = wa.bottom − 96 | 球心距屏幕下缘 39 |

`dockPos` 取整并限制在 `[58, 边长 − 58]`。默认值为沿边中点。

### 4.3 便签窗口与原点

| 边 | 窗口位置 | 展开原点 originX / originY |
| --- | --- | --- |
| right | x = wa.right − stageW；y = wa.y + clamp(dockPos − stageH/2, 10, wa.height − stageH − 10) | originX = stageW − 39；originY = dockPos − (y − wa.y) |
| left | x = wa.x；y 同 right | originX = 39；originY 同上 |
| top | y = wa.y；x = wa.x + clamp(dockPos − stageW/2, 10, wa.width − stageW − 10) | originX = dockPos − (x − wa.x)；originY = 39 |
| bottom | y = wa.bottom − stageH；x 同 top | originX 同上；originY = stageH − 39 |

面板尺寸还会按工作区收窄：宽度取 `min(384, wa.width − 20)`，高度取 `min(560, wa.height − 20)`，最小 280。

关闭动画回到的球尺寸：`scaleX = 58 / stageW`，`scaleY = 58 / stageH`，原点同上，因此缩回点与 dock 悬浮球球心重合。

## 5. 自动收起

- 展开后（含 opening 阶段）轮询光标；光标在面板矩形内即重置计时。
- 光标连续离开 1000ms 触发收起；固定（pin）时永不触发。
- 判定使用面板矩形（窗口 bounds），不是视觉圆角，避免边缘抖动。
- 光标离开面板不隐藏 dock（面板打开时 dock 已隐藏），收起完成后再回归玻璃条。

## 6. 文本与数据

| 数据 | 存储 | 生命周期 |
| --- | --- | --- |
| 便签正文 | `localStorage['side-note.text']` | 应用重启保留；随 userData 目录 |
| 停靠边/位置 | `%APPDATA%/side-note/dock.json`，`{ edge, pos }` | 仅拖动吸附成功时写入 |

- 输入变化后 350ms 防抖保存；关闭、`beforeunload` 时立即保存。
- 状态栏文案：`保存中…` → `已保存 HH:mm` → 无记录时 `自动保存`。
- 打开时聚焦编辑器并把光标放到末尾。

## 7. 边缘情况

| 场景 | 行为 |
| --- | --- |
| 首次运行 / 状态文件损坏 | 右侧居中停靠 |
| 重复启动应用 | 若便签已关闭则直接打开；否则无操作 |
| 显示器工作区变化 | 使玻璃底图失效；便签关闭时重新定位 dock |
| 显示器被移除 | 关闭便签并重新定位 dock |
| 截图失败或超时 | 使用纯色玻璃底色打开，不阻塞、不重试等待 |
| 渲染进程未回报 armed | 260ms 后强制显示面板 |
| 形变未回报 settled | 1200ms 后标记 open |
| 收起未回报 closed | 900ms 后强制关闭 |
| 拖拽丢失指针 | 6s 后自动恢复原状态 |
| `prefers-reduced-motion` | 形变与过渡降至 1ms |
| 拖拽指针被取消 / 6s 无响应 | 取消拖拽，位置保持不变 |

## 8. 玻璃底图（用户可感知的行为）

- 便签的“毛玻璃”是**打开前捕获的桌面截图**（面板区域，四分之一分辨率），经模糊后裁剪进圆角玻璃内。
- 底图在空闲时维护：启动后、拖拽吸附后、以及便签关闭且光标不在停靠区时每 6s 刷新一次。
- 打开时绝不等待捕获；使用最近一次缓存，没有缓存则显示纯色玻璃。
- 因此：底图最多可能比真实桌面晚约 6 秒，且模糊后不可察觉；播放视频等动态内容会被“定格”在模糊层。

## 9. 参数总表

| 参数 | 值 | 位置 |
| --- | --- | --- |
| 轮询间隔 | 32ms | `electron/main.cjs` |
| peek 延迟 / 取消延迟 | 60ms / 220ms | 同上 |
| 自动收起延迟 | 1000ms | 同上 |
| 打开兜底 / 落位兜底 / 收起兜底 | 260ms / 1200ms / 900ms | 同上 |
| dock 隐藏延迟（面板显示后） | 90ms | `hideDockForPanel()` |
| 拖拽安全恢复 | 6000ms | `dock:grab` |
| 底图捕获超时 | 900ms（仅后台） | `refreshBackdrop()` |
| 空闲底图刷新 | 6000ms | `tick()` |
| 展开形变 / 收起形变 | 500ms / 330ms | `src/Note.tsx` |
| 内容淡入 | 180ms 透明度 / 240ms 位移 | `src/note-view.css` |
| 拖拽阈值 | 5px | `src/dock.ts` |
| 吸附动画 | 240ms | `src/dock.ts` / `dock.css` |
| 自动保存防抖 | 350ms | `src/Note.tsx` |

## 10. 验收标准

| # | 标准 | 验证方式 |
| --- | --- | --- |
| 1 | 点击到面板显示 ≤50ms | 主进程计时或录屏逐帧；本机实测 9–19ms |
| 2 | 点击时 dock 窗口保持 96×96，悬浮球不消失 | 读取窗口 bounds + 录屏 |
| 3 | 展开是一条单调的形变曲线（58px 球 → 全尺寸） | 渲染层 MutationObserver 记录 scale |
| 4 | 展开无白底、无直角、无第二次弹出 | 30fps 录屏逐帧 |
| 5 | 内容只在玻璃落位后出现 | 录屏 + `is-ready` 时序 |
| 6 | 拖动吸附到最近边并持久化 | `dock.json` + 窗口位置 |
| 7 | 移开光标 1s 后收起，330ms 后 dock 回归 | 录屏 |
| 8 | 文字重启后保留 | 重启应用检查 |
| 9 | 四边均可停靠、展开原点与球心重合 | 依次拖动四边并点击 |
| 10 | 深色模式下玻璃、文字、描边正常 | 系统切换深色 |

## 11. 实现位置

- 状态机、几何、轮询、截图、IPC：[electron/main.cjs](../electron/main.cjs)
- 停靠层交互与拖拽：[src/dock.ts](../src/dock.ts)、[src/dock.css](../src/dock.css)
- 便签形变与文本：[src/Note.tsx](../src/Note.tsx)、[src/note-view.css](../src/note-view.css)
