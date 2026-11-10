# 随手记 · Side Note

一个常驻屏幕边缘的轻量便签：平时只是一条玻璃小条，悬停弹出笔形悬浮球，点击后从球的位置生长出一张毛玻璃便签，写完移开鼠标自动收起。

- 技术栈：Electron 45 + Vite 8 + React 19 + TypeScript
- 平台：Windows（重点适配 DPI 125% 与透明无边框窗口）
- 数据：单条纯文本，保存在本机 `localStorage`；停靠位置保存在 `%APPDATA%/side-note/dock.json`

## 快速开始

```bash
npm install
npm run dev      # Vite + Electron 开发模式
npm run build    # 构建 dist/
npm start        # 运行已构建版本
```

## 文档索引

| 文档 | 内容 | 适合谁 |
| --- | --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | 功能规格、交互状态机、全部参数与验收标准 | 产品、测试、接手开发 |
| [docs/DESIGN.md](docs/DESIGN.md) | 视觉规范、玻璃配方、动效与组件样式 | UI、前端、AI 视觉改动 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 双窗口架构、IPC 契约、坐标/DPI、截图毛玻璃管线 | 开发者、AI 重构 |
| [AGENTS.md](AGENTS.md) | 给 AI / 新同事的硬性约束与验证流程 | AI 编码助手、新成员 |

## 目录结构

```
electron/main.cjs     主进程：窗口、状态机、轮询、截图、IPC
electron/preload.cjs  contextBridge 暴露的窗口 API
dock.html             停靠层页面（玻璃条 / 悬浮球 / 拖拽层）
src/dock.ts           停靠层交互：悬停、点击、拖拽吸附
src/dock.css          停靠层样式
index.html            便签页面
src/Note.tsx          便签内容、状态、展开/收起形变
src/note-view.css     便签玻璃层与内容样式
src/env.d.ts          窗口 API 的类型声明
vite.config.ts        双入口构建（index + dock）
web/                  官网源码（静态 HTML/CSS/JS，含可交互原型）
```

## 官网

`web/` 是官网源码，包含一个网页版的悬停笔球/便签交互演示。发布前运行：

```bash
node web/build.mjs   # 生成 web/dist 作为站点发布产物
```

## 当前范围

已实现：四边停靠、悬停弹出、点击展开、玻璃形变、拖动吸附、自动收起、固定、自动保存、退出、单实例。

尚未包含：安装包、托盘、开机自启、多显示器、多便签、富文本、全局快捷键。
