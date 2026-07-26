<div align="center">

<img src="src-tauri/icons/icon.png" width="96" height="96" alt="Glyphra 图标" />

# Glyphra

**为「agent 写代码、人来驾驭」而生的编辑器。**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[为什么选 Glyphra](#为什么选-glyphra) · [快速开始](#快速开始) · [架构](#架构一瞥) · [文档](#文档) · [路线图](#现状与路线图)

<br />

![release](https://img.shields.io/badge/release-v0.2.0-6366f1?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![stack](https://img.shields.io/badge/Tauri_2-React_19-0f172a?style=flat-square)
![platforms](https://img.shields.io/badge/Windows_·_macOS_·_Linux-CI-green?style=flat-square)

</div>

---

大多数 IDE 是为「人逐行敲代码」设计的。Glyphra 面向现在真实发生的工作流：把任务交给 coding agent，实时看它规划与编辑，把注意力放在**审阅与驾驭**上，而不是打字。

调试器、插件市场、任务系统是前 agent 时代的重型遗产 —— Glyphra 有意不做。留下的是一台极轻的 Tauri 应用：CodeMirror 6、ACP 归一化的 agent 时间线，以及以 git checkpoint 审阅为主交互。

> **状态：`0.2.0` —— 第一个正式版。** 签名的应用内更新、checkpoint 审阅与完整编辑器能力均已就绪，可用于日常开发。仍处于 `0.x`：设置项与 harness 契约在小版本之间仍可能调整，应用二进制也尚未做代码签名。安装包见 [GitHub Releases](https://github.com/Mar7thLover/Glyphra-IDE/releases) · 更新日志见 [`CHANGELOG.md`](./CHANGELOG.md) · 发布说明见 [`docs/releasing.md`](./docs/releasing.md)。

## 为什么选 Glyphra

| 支柱 | 你会得到什么 |
| --- | --- |
| **Agent 原生** | 自动探测 `PATH` 上的 Codex、Claude Code、Pi、OpenCode，走各自原生协议 —— 不是套一层最低公分母的 shim。自定义 ACP / JSONL / shell / HTTP harness 共用同一套 UI。 |
| **审阅优先** | 每一轮 agent turn 都会打进 shadow git 快照。逐 hunk 展示、字节级可还原；接受或拒绝的体验接近审 PR。 |
| **运行中可驾驭** | 模型、reasoning effort、Fast 模式、权限档（请求审批 / 自动批准 / 完全放行）可在会话中途切换，无需拆掉原生线程。 |
| **用量可见** | 订阅与 API Key 用量 —— 上下文窗口、限流窗口、额度 —— 归一成一种快照，直接显示在 composer。 |
| **真正轻量** | Tauri 2 + 系统 WebView，不是 Electron。冷启动约一秒、空闲内存低，Windows 11 支持 Mica/Acrylic，编辑器用 CodeMirror 6 而非捆绑 Monaco。 |

## 里面有什么

| 模块 | 说明 |
| --- | --- |
| **Harness 目录** | 启动时读取各 CLI 原生的模型列表、reasoning、上下文窗口与权限画像，composer 反映真实安装能力。 |
| **ACP 归一化会话** | Codex JSON-RPC、Claude stream-json、Pi JSON、OpenCode ACP，以及自定义 stdio/JSONL/shell 与 OpenAI/Anthropic HTTP —— 全部桥成同一时间线（[契约](./docs/harness-api.md)）。 |
| **Checkpoint 审阅** | 按 turn 的 shadow 快照；审阅面板含 turn 分组、工作区 diff、键盘裁决（`j/k`、`a/r`）与整轮还原。 |
| **工作树看板** | 在审阅面板中创建仓库的并行检出；每个工作树独立开窗，拥有各自的 Agent 会话、终端与 Checkpoint 历史。 |
| **会话存档** | 本地 JSONL 存档（列表 / 加载 / 删除）；恢复优先原生 `session/resume` → `session/load`，再退回上下文续接。 |
| **编辑器内核** | CodeMirror 6、语言自动探测、VS Code 风格键位、未保存保护、命令面板、ripgrep 搜索、PTY 终端。 |
| **内联编辑** | `Ctrl+K` 用一个隐藏、禁用工具的 Agent 会话就地重写选区 —— `Enter` 采纳、`Esc` 丢弃；可选的幽灵文本补全复用同一会话。 |
| **编辑器体验** | 缩略图、面包屑、粘性滚动、缩进参考线、括号配色、`Ctrl+Shift+O` 符号跳转、编码探测、EditorConfig、保存时格式化，以及 VS Code 主题 JSON 导入。 |
| **语言服务器** | 按语言懒启动，提供补全、悬停、转到定义、查找引用与重命名。不捆绑任何服务器：自行安装并放进 `PATH`，打开对应文件时 Glyphra 自动接管。 |
| **问题面板** | 诊断存储由语言服务器、构建、终端输出与 agent 回合共同喂入，呈现在 gutter 与独立面板中。 |
| **MCP 管理** | 在设置中增删改与启停 MCP server，无需手写 JSON。 |
| **更新** | `tauri-plugin-updater` + minisign 签名清单与应用内更新提示条；安装包本身暂未签名。 |
| **健壮性** | 每窗口错误边界、落盘 tracing 与 `panic.log`、脏缓冲自动保存与热退出恢复，以及可选的诊断包导出。 |
| **Onboarding** | 首启检测 git / Node / agent CLI，并提供 winget · irm · npm 安装引导。 |

## 快速开始

**前置：** [Rust](https://rustup.rs/)（stable ≥ ~1.85）、[Node.js](https://nodejs.org/) ≥ 20、[pnpm](https://pnpm.io/)、git。Agent CLI（Codex、Claude Code 等）**不捆绑** —— 自行安装常用工具，Glyphra 会在 `PATH` 上发现它们。

```sh
pnpm install
pnpm tauri dev
```

常用脚本：

```sh
pnpm test              # vitest
pnpm typecheck         # tsc --noEmit
pnpm check:bindings    # 生成的 IPC 类型是否与 src-tauri 一致
pnpm check:size        # 前端包体预算
pnpm check:version     # package / tauri / cargo 版本一致性
pnpm licenses:check    # 依赖许可策略与 THIRD-PARTY.md 是否最新
pnpm tauri build       # 各平台安装包（见 docs/releasing.md）
pnpm release:windows   # NSIS + MSI + 便携版 exe，并校验产物
```

后端自检（无需 GUI）：debug 构建后执行 `./src-tauri/target/debug/glyphra --smoke`，打印一行 JSON 状态后退出。

仅前端 Vite 预览（无 Rust IPC）：`pnpm dev`，端口 `1420`。

## 架构一瞥

```
┌─ Glyphra (Tauri 2) ─────────────────────────────────────────┐
│  React 19 · Zustand · CodeMirror 6 · streamdown · xterm     │
│    Agent 面板 · 审阅中心 · 编辑器 · 搜索 · 终端             │
│    lib/acp AgentBus  ←── 类型化 IPC (ts-rs) ──→  Rust 核心  │
│  agent/ · gitx/ · pty · search · vault · providers          │
└─────────────────────────────────────────────────────────────┘
        │ 原生 CLI / 自定义 harness（stdio · HTTP）
        ▼
  Codex · Claude Code · Pi · OpenCode · 你的适配器
```

- **前端**拥有 ACP 会话语义；**Rust**负责进程监管、framing、checkpoint、PTY、搜索与系统钥匙串。
- 所有 harness 桥成同一种 ACP 形态事件流（`message.delta`、`plan`、`tool.*`、`done`、`error`）—— UI 只需理解这一种形状。
- IPC 类型由 `ts-rs` 生成；`pnpm check:bindings` 在漂移时让 CI 失败。

## 文档

| 文档 | 用途 |
| --- | --- |
| [docs/README.md](./docs/README.md) | 文档索引 |
| [docs/TODO.md](./docs/TODO.md) | 近期执行 backlog |
| [docs/releasing.md](./docs/releasing.md) | 打标发布 / 打包指南 |
| [docs/release-drills.md](./docs/release-drills.md) | 发布前的全新安装、更新与故障演练 |
| [CHANGELOG.md](./CHANGELOG.md) | 各版本发布说明 |
| [docs/development-plan.md](./docs/development-plan.md) | 完整产品计划与里程碑 |
| [docs/harness-api.md](./docs/harness-api.md) | 自定义 harness / Provider 契约 |
| [docs/git-review-ux-plan.md](./docs/git-review-ux-plan.md) | 审阅中心 UX 蓝图 |
| [docs/ime-checklist.md](./docs/ime-checklist.md) | 编辑器改动的中文 IME 手测门禁 |
| [AGENTS.md](./AGENTS.md) | Cursor Cloud / agent 贡献者说明 |

## 现状与路线图

| 里程碑 | 焦点 | 状态 |
| --- | --- | --- |
| **M0** | 壳、编辑器、主题、CI、smoke | 已完成 |
| **M1** | Agent 核心、Provider、onboarding、存档 | 已完成 |
| **M2** | Checkpoint、审阅、终端、搜索、命令面板 | 已完成 |
| **M2.5** | 熔断、字节级 ckpt、IME 门禁 | 已完成 |
| **M3** | 多窗口、NSIS / portable、updater、Release | 已完成 |
| **审阅 R2–R3** | 选区呼叫 agent、行内呈阅、提交辅助 | 已完成 |
| **v0.2** | 问题面板、MCP 管理、快捷键自定义、主题导入、恢复 | 已完成 |

接下来：端到端组件测试层、Gemini CLI、Codex app-server 原生 Rust 客户端（去 Node）、SignPath 签名。

有序的近期任务清单见 [docs/TODO.md](./docs/TODO.md)。

## 许可

[MIT](./LICENSE) —— Glyphra 及捆绑依赖均为 MIT 兼容。Agent CLI **不随应用分发**；Glyphra 探测并驱动你本机已安装的工具。

自定义集成契约：[docs/harness-api.md](./docs/harness-api.md)。
