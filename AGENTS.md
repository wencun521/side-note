# AGENTS.md · 随手记

给 AI 编码助手 / 新同事的工作约定。先读文档再改代码：

1. [docs/SPEC.md](docs/SPEC.md) — 行为与参数（唯一事实来源）
2. [docs/DESIGN.md](docs/DESIGN.md) — 视觉、玻璃、动效
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 双窗口、IPC、坐标、截图管线
4. [README.md](README.md) — 运行方式与目录

## 命令

```bash
npm run dev      # 开发（Vite + Electron）
npm run build    # 构建 dist/（改完必须跑）
npm start        # 运行构建产物
npx electron . --remote-debugging-port=9222   # 调试/验证
```

无 TypeScript 检查脚本；`tsconfig.json` 为 `noEmit`，构建由 Vite 完成。改动 `src/` 后至少执行一次 `npm run build`。

## 代码地图

| 文件 | 职责 |
| --- | --- |
| `electron/main.cjs` | 两窗口、状态机、32ms 光标轮询、几何、截图、IPC、兜底定时器 |
| `electron/preload.cjs` | `window.sideNote` / `window.sideNoteDock` |
| `src/dock.ts` | 停靠层手势：悬停、点击、拖拽、吸附动画 |
| `src/dock.css` | 条、球、拖拽球、参考线样式 |
| `src/Note.tsx` | 便签状态、形变动画、保存、快捷键 |
| `src/note-view.css` | 玻璃层、形变、内容、深色模式 |
| `src/env.d.ts` | IPC 载荷类型，改契约必须同步 |

## 官网

- `web/` 是独立静态站点，与 Electron 应用无构建依赖；交互演示在 `web/demo.js`，视觉在 `web/styles.css`。
- 修改后执行 `node web/build.mjs` 生成 `web/dist`，再按 Sites 流程发布；`.随手记 Side Note.qoder.site` 由工作台生成，不要手写。

## 硬性约束（违反会直接复现历史 bug）

1. **点击不得调用 `grab()`，也不得改变 dock 窗口尺寸。** 只有指针位移 ≥5px 才进入拖拽。否则悬浮球会“怪跳消失”，点击变慢。
2. **打开路径不得 `await` 截图。** 只读 `cachedBackdrop()`；截图只在空闲（面板关闭、未 peek、未拖拽）或吸附后后台刷新。
3. **dock 必须在 panel 显示之后才隐藏**（`armPanel()` 内，延迟 90ms）。先隐藏会出现球消失、便签再弹出的双段动画。
4. **内容层只能在玻璃落位后显示**（`is-ready` + `panel:settled`）。提前显示会让文字露在圆角外。
5. **不要使用 Acrylic / `setBackgroundMaterial`，也不要用 `backdrop-filter` 做便签玻璃。** 玻璃 = 桌面截图裁剪 + `blur(8px)`；理由见 DESIGN §4.2。
6. **形变只动 transform/opacity**，不要逐帧 `setBounds` 或动画 width/height。
7. **屏幕坐标一律 DIP**；渲染层用 `clientX + window.screenX`，`pointerup` 用自身坐标。
8. **状态归主进程**；渲染层通过 `armed / settled / closed` 推进状态机。新增异步步骤必须配超时兜底（260/1200/900/6000ms 的既有模式）。
9. **不改窗口级策略**（focusable、alwaysOnTop、ignoreMouse）而不更新 ARCHITECTURE 的窗口表。
10. **视觉参数改 DESIGN.md，行为参数改 SPEC.md**，再改代码；`main.cjs` 常量、CSS、文档三处必须一致。

## 改动流程

1. 定位：行为 → `main.cjs` 状态机/tick；手势 → `dock.ts`；形变/内容 → `Note.tsx` + CSS。
2. 改前在 SPEC/DESIGN 找到对应条款；没有就先补文档。
3. 保持既有命名与结构（`dock:*` / `panel:*` 通道、`is-*` 状态类、CSS 令牌）。
4. 不加依赖、不引入新框架、不重构无关代码。
5. `npm run build`，再按下方清单在真实窗口验证。

## 验证清单

- 点击：球不消失、dock 窗口保持 96×96、便签 ≤50ms 开始显示、单段形变（无白底/直角/二次弹出）。
- 悬停：条区 60ms 出球，离开 220ms 收回。
- 拖动：≥5px 才进入拖拽；四边吸附；`%APPDATA%/side-note/dock.json` 更新；点一下不会触发拖拽。
- 收起：移开 1s 收起 330ms，dock 条回归；固定后不自动收起。
- 文本：输入 350ms 后显示已保存；重启后保留。
- 视觉：玻璃贴边无方角、内容不越界、深色模式正常。

自动化提示：DPI 125% 下 PowerShell `SetCursorPos` 用 DIP；必须**先悬停条区（距边 ≤30px）再移到球心（距边 39px）**才能点击。录屏用 `ffmpeg -f gdigrab -framerate 30 -video_size 1920x1080 -i desktop -t 3 out.mp4` 抽帧检查。

## 清理

验证用的截图、录屏、临时探针脚本不要留在仓库根目录；临时 `console.log` 在提交前删除。
