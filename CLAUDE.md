# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Forge Studio 是一个基于 Electron + Vue 3 + TypeScript 的桌面工具箱应用。使用 `electron-vite` 打包，`pnpm` 管理依赖。

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式启动
pnpm start            # 预览构建产物
pnpm build            # 类型检查 + 构建
pnpm build:win        # 构建 Windows 安装包
pnpm build:mac        # 构建 macOS 安装包
pnpm build:linux      # 构建 Linux 安装包
pnpm test             # 运行所有测试 (vitest run)
pnpm test:watch       # 监听模式运行测试
pnpm lint             # ESLint 检查
pnpm format           # Prettier 格式化
pnpm typecheck        # 类型检查（node + web）
pnpm typecheck:node   # 仅主进程类型检查
pnpm typecheck:web    # 仅渲染进程类型检查 (vue-tsc)
```

## 代码架构

```
src/
├── main/                  # Electron 主进程
│   ├── index.ts           # 入口：创建窗口、注册 IPC、组装所有 domain
│   ├── core/              # 核心服务（与 domain 无关的基础设施）
│   │   ├── settings-store.ts  # 设置读写、序列化、patch 合并
│   │   ├── secrets.ts     # API Key 安全存储（系统凭据管理）
│   │   ├── shortcuts.ts   # 全局快捷键注册
│   │   ├── tray.ts        # 系统托盘
│   │   ├── updates.ts     # 应用自动更新
│   │   ├── autostart.ts   # 开机自启
│   │   ├── ai-client.ts   # AI API 调用工具（流式解析、URL 构建）
│   │   └── mcp-client.ts  # MCP JSON-RPC 客户端（子进程通信）
│   ├── domains/           # 功能域（每个 domain 是独立的功能模块）
│   │   ├── custom-modules/   # AI 自定义模块（流式问答、搜索、图表）
│   │   ├── external-window/  # Windows 原生窗口操作（Win32 API）
│   │   ├── window-stash/     # 窗口收纳（边缘隐藏/恢复/置顶）
│   │   ├── eye-overlay/      # 护眼遮罩
│   │   ├── reminders/        # 定时提醒/休息闹钟
│   │   ├── snip/             # 截屏
│   │   ├── stickers/         # 贴图
│   │   ├── sticky-notes/     # 便签
│   │   ├── translator/       # 翻译
│   │   ├── weather/          # 天气
│   │   ├── fun-fact/         # 每日趣味内容（AI 生成）
│   │   └── scheduled-tasks/  # 定时任务（关机等）
│   ├── window-stash.ts    # window-stash 主逻辑（代码量最大的模块）
│   ├── external-window.ts # external-window 的公开导出
│   └── shared/primitives.ts # 主进程用的纯函数工具
├── preload/               # Electron preload 脚本
│   └── index.ts           # 通过 contextBridge 暴露 window.electron.ipcRenderer
├── renderer/              # Vue 3 渲染进程
│   └── src/
│       ├── App.vue        # 根组件：根据 URL ?mode= 参数切换视图
│       ├── main.ts        # 入口：初始化 Vue、Ant Design、路由、设置状态
│       ├── router/index.ts # Vue Router 路由配置（hash 模式）
│       ├── state/settings.ts # 设置状态管理（与主进程通过 IPC 同步）
│       ├── composables/   # Vue Composition API hooks
│       ├── components/    # 可复用组件
│       ├── views/         # 页面视图
│       └── utils/         # 渲染进程工具函数
├── shared/                # 主进程和渲染进程共享的类型/常量
│   ├── settings.ts        # AppSettings 类型定义、默认值、SettingsPatch
│   ├── ai-providers.ts    # AI 提供商配置映射
│   └── custom-modules.ts  # 自定义模块类型和 IPC 事件常量
└── libs/                  # 本地库（答案之书、休息提示词等）
```

## 关键设计模式

### Domain 工厂模式

所有 domain 使用工厂函数模式：`createXxxDomain(deps)` 返回 `{ registerIpcHandlers, ...方法 }`。依赖通过参数显式注入（如 `getSettings`、`loadWindow`），不直接 import 其他 domain。

### App 多模式分发

`App.vue` 根据 URL 参数 `?mode=` 渲染不同根视图。一个 Electron 窗口可加载为不同模式：`main`（主界面）、`overlay`（护眼遮罩）、`alarm`（闹钟弹窗）、`stash-handle`（收纳手柄）、`sticker`（贴图）、`note-editor`（便签编辑）、`translator-popup`（翻译弹窗）。

### 设置同步流程

设置由主进程持有唯一权威副本（`settings.json`）。渲染进程通过 IPC 获取：`settings:get`、`settings:update`（带 patch）。主进程通过 `settings:changed` 广播到所有窗口。设置 store 使用 `structuredClone` 进行不可变更新。

### IPC 通道规范

- 同步数据：`module:action` 格式（如 `settings:get`、`update:check`）
- 事件推送：主进程通过 `webContents.send` 推送，渲染进程通过 `ipcRenderer.on` 监听
- Domain 事件常量集中在 `shared/custom-modules.ts` 中的 `CUSTOM_MODULES_EVENTS` 类模式

### ESLint 域隔离规则

`src/main/domains/` 下的文件禁止 `../` 相对引用和 `@main/*` 别名引用——只能使用 `./` 同级导入、`@main-core/*` 和 `@shared/*`。这防止 domain 之间的隐式耦合。

## 技术栈

| 层       | 技术                                        |
| -------- | ------------------------------------------- |
| 框架     | Electron 39                                 |
| 前端     | Vue 3.5 (Composition API, `<script setup>`) |
| UI 库    | Ant Design Vue 4                            |
| 样式     | Tailwind CSS 3 + SCSS (sass-embedded)       |
| 图表     | ECharts 6                                   |
| 编辑器   | Tiptap (富文本便签)                         |
| 打包     | electron-vite 5                             |
| 分发     | electron-builder (NSIS/DMG/AppImage)        |
| 测试     | Vitest 3 + jsdom                            |
| 代码规范 | ESLint 9 + Prettier 3                       |
| 包管理   | pnpm                                        |

## 代码风格

- 2 空格缩进，单引号，无分号，行宽 100，拖尾逗号禁用
- 所有 Vue 组件 `<script>` 使用 `lang="ts"`
- Vue 组件无需 `multi-word` 命名，无需 `require-default-prop`
- 优先使用 `path` 别名导入：`@main`, `@shared`, `@main-shared`, `@main-core`, `@libs`, `@renderer`

## 测试

- 测试运行器：Vitest，使用 jsdom 环境
- 测试文件位置：
  - 单元测试可直接放在源文件旁边（如 `parsers.test.ts`、`selection.test.ts`）
  - Vue 组件测试放在 `__tests__/` 目录（如 `ScreenshotsApp.click.test.ts`）
- 测试配置文件：`vitest.config.ts`，Path 别名需要与 `electron.vite.config.ts` 保持一致
