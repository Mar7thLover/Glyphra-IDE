# Glyphra — Agent-First 轻量 IDE 实施计划

## Context(为什么做)

替代 VSCode 的**以 agentic work 为中心**的文本编辑器兼轻量 IDE:

- **做减法**:丢弃以手工改码/调试为中心的重型设施(调试器/DAP、插件平台、任务系统)。人类的主要工作是**阅读、审阅、驾驭 agent**,不是逐行敲代码。
- **轻与快**:像文本编辑器一样秒开、低常驻内存 —— 对 VSCode/Electron 系的核心不满。
- **视觉第一**:Cursor 式小清新观感、流畅微动效、Win11 Mica、可视化 agent 工作流(流式对话、工具卡片、计划清单、变更审阅队列)。
- **AI 原生**:以子进程方式包装开源 agent CLI harness(不捆绑、引导安装),**免费继承它们的订阅 OAuth 与 API Key 两套认证**;Glyphra 自身保持 MIT 干净。
- **MIT 开源**,项目名 **Glyphra**。当前 D:\Projects\Glyphra-IDE 为空目录、非 git 仓库,从零开始;开发机 Windows 11,Windows 优先、CI 三平台。

## 已确认决策(用户拍板,2026-07-18)

1. 技术底座:**Tauri 2 全新自研**(否决 VSCodium 魔改与 Electron)
2. 编辑器内核:**CodeMirror 6**(@codemirror/merge 做逐 hunk 审阅)
3. v1 agent:**Codex CLI + Claude Code** 一等公民,内部统一 ACP 协议。**用户特别要求**:利用 Codex 可配任意 OpenAI 兼容端点的能力做「自定义 Provider(base_url + Key + 模型)」,覆盖 OpenRouter/DeepSeek/本地模型;同时把 **Pi Coding Agent** 纳入「兼容型自定义 Agent Harness」目标:若 Pi 提供 OpenAI-compatible endpoint,先经 Codex custom provider 路由;若 Pi 提供 CLI/stdio/JSONL/ACP 协议,通过 Glyphra AgentBus 增加专用 adapter,不改 UI 工作流。
4. v1 附加:**全局搜索(ripgrep 内核)+ 多窗口多项目**;基础 LSP 与 VSCode 主题导入进 roadmap
5. 非目标(v1):调试器、VSCode 插件兼容、远程开发、Notebook、自研 LLM loop

## 架构总览

```
┌─ Glyphra (Tauri 2.9+, Rust) ────────────────────────────────┐
│  WebView2 前端: React 19 + TS + Tailwind 4 + CodeMirror 6   │
│    ├─ Agent 面板(streamdown 流式 md、工具卡、计划卡、审批)│
│    ├─ 审阅中心(变更队列 + unifiedMergeView 逐 hunk 接/拒) │
│    ├─ 编辑器/文件树/命令面板/全局搜索/终端(xterm.js)     │
│    └─ lib/acp: AgentBus + @agentclientprotocol/sdk(前端拥有│
│       协议语义;Rust 只做传输与生命周期)                   │
│  Rust 核心:                                                 │
│    ├─ agent/supervisor: spawn/kill/env 注入/JSONL framing/  │
│    │   win32job(KILL_ON_JOB_CLOSE 防孤儿,含孙进程)       │
│    ├─ ACP 桥:子进程 stdio JSONL ⇆ Tauri Channel            │
│    ├─ pty(portable-pty/ConPTY)/ watcher(notify)         │
│    ├─ search(grep+ignore = 内嵌 ripgrep)                  │
│    ├─ gitx: shell-out git + shadow-repo checkpoint 引擎     │
│    └─ vault(keyring → Windows 凭据管理器)                 │
└─────────────────────────────────────────────────────────────┘
        │ 子进程(npx 适配器,stdio NDJSON/ACP)
        ▼
  @agentclientprotocol/codex-acp ──启动──▶ codex app-server
  @agentclientprotocol/claude-agent-acp ─▶ claude(Agent SDK)
  custom-agent adapter ────────────────▶ Pi Coding Agent / 其他 CLI harness
  (订阅 OAuth 在各 CLI 自己家目录;API Key 由 Glyphra 保管、
   spawn 时以 env 注入,前端永远看不到明文)
```

关键裁定:两家 agent 统一走 **ACP 官方适配器**(前端只懂一种协议);codex app-server 原生 Rust 客户端留作 roadmap(去 Node 依赖)。运行时前置依赖 = git、Node ≥20、用户自装 codex/claude,onboarding 全检测并给 winget/irm 安装引导。

## 关键生态事实(2026-07 联网已核实,实现时以此为准)

- **ACP**:org 已从 zed-industries 迁至 `agentclientprotocol/*`;TS SDK = **`@agentclientprotocol/sdk`**(旧包已弃用),NDJSON over stdio,基于 Web Streams,新 API 为 `client()`/`agent()` fluent 函数。
- **codex-acp** = `@agentclientprotocol/codex-acp`(Apache-2.0,`npx -y` 启动,内部起 `codex app-server`)。关键 env:`CODEX_API_KEY`/`OPENAI_API_KEY`、`CODEX_PATH`、**`CODEX_CONFIG`(JSON 合并进 session 配置 —— 自定义 Provider 的官方注入点)**、`INITIAL_AGENT_MODE`(read-only|agent|agent-full-access)。
- **claude-agent-acp** = `@agentclientprotocol/claude-agent-acp`(Apache-2.0,内部用官方 Claude Agent SDK 驱动 claude 二进制),权限/edit review/TODO/terminal/slash commands 全部已映射为 ACP 语义。**不走裸 stream-json**(事件 schema 无正式文档,自维护成本高)。
- **Codex CLI 0.144.x**:官方 IDE 集成面 = `codex app-server`(JSON-RPC 2.0 over JSONL;`codex proto` 旧、`exec --json` 仅脚本用)。**⚠ `wire_api="chat"` 已于 2026-02 移除,只剩 `"responses"`** —— 自定义端点必须支持 OpenAI **Responses API**;OpenRouter 有兼容面,DeepSeek 直连/多数本地服务需经 LiteLLM 等网关。`CODEX_HOME` 会连 auth.json 一起重定位(整目录克隆会丢登录态,**不可取**);profiles 现为独立文件 `$CODEX_HOME/<name>.config.toml`。Windows 原生 sandbox 仍 experimental —— 安全语义靠审批策略,不依赖 sandbox。
- **Claude Code**:Windows 原生一等公民(`irm https://claude.ai/install.ps1 | iex`),**npm 安装已弃用**;`--resume/--session-id` 恢复会话。
- **Pi / earendil-works/pi**:MIT,AI agent toolkit/harness,包含 `@earendil-works/pi-ai`(统一多 provider LLM API:OpenAI/Anthropic/Google 等)、`@earendil-works/pi-agent-core`(agent runtime)、`@earendil-works/pi-coding-agent`(交互式 coding agent CLI)、`@earendil-works/pi-tui`。它不是单纯模型 endpoint,而是可作为 Glyphra 的第三个 agent harness 候选。M1 策略:先做 `pi-agent` adapter spike;若 `pi-coding-agent` CLI 暴露稳定 stdio/JSON/JSONL,走子进程协议适配;若包 API 更稳定,用 Node adapter 子进程直接调用 `pi-agent-core`/`pi-ai`;若后续支持 ACP,直接注册为 ACP backend。
- **Tauri 2.9.x**:Mica 内建(`windowEffects: ["mica"]`,Acrylic 拖动性能差不用;Win10 降级纯色);自定义标题栏保 Snap Layouts 用 `tauri-plugin-decorum`[实现时复核,兜底 overlay 自绘];插件:updater(minisign)、single-instance、dialog、persisted-scope;**长驻子进程用 `std::process` + tokio 自管,不用 shell 插件**;Channel 有序且为流式设计,PTY 输出 Rust 侧 8ms 合帧再推,大内容一律命令按需拉取、不过 IPC。
- **前端**:Vite 8 + @vitejs/plugin-react v6;Tailwind **4.2**(@tailwindcss/vite);motion v12(`motion/react`);zustand v5;cmdk;**react-virtuoso**(聊天流 followOutput + 文件树/搜索复用);**streamdown v2.5**(Vercel,Apache-2.0,专为 token 流设计,内置 Shiki/CJK;react-markdown 每 token 全量重解析,否决);lucide-react;react-i18next(en/zh-CN)。
- **CM6**:`@codemirror/merge` 的 `unifiedMergeView` **内建逐 chunk accept/reject 按钮** + `acceptChunk/rejectChunk` API + `allowInlineDiffs`;键位 `@replit/codemirror-vscode-keymap`;语言 `@codemirror/language-data` 懒加载;>10MB 或超长行降级只读关高亮。**⚠ WebView2 + 中文 IME 与 CM 有历史组合缺陷**:锁最新 @codemirror/view,M2 设 IME 手测门禁(微软拼音/搜狗)。
- **xterm**:`@xterm/xterm` v6(旧包全弃用,**addon-canvas 已移除**)→ `addon-webgl` + context-loss 回退 DOM 渲染器;fit/search/web-links/unicode11。PTY = portable-pty 0.9(ConPTY;resize 伪影风险,踩到切 psmux 补丁系)。
- **Rust crates**:keyring 3(feature `windows-native`,**多线程无序 → 全局 Mutex 串行**);notify + debouncer(300ms);grep 0.4 + ignore 0.4(Unlicense/MIT);win32job;sysinfo(仅 smoke);tracing;**git 一律 shell-out**(git2=libgit2 许可烦、gitoxide API 不全,均否决)。
- **打包**:NSIS 预估 12-18MB(<30MB 宽裕);updater 的 minisign 私钥进 GH secret 且离线双备份(丢失即无法推更新);**v0.x 不签名**(README 写 SmartScreen 绕行),开源后申请 SignPath Foundation 免费 OSS 签名(Azure Artifact Signing 个人档仅美加,不可用);portable exe 当附加产物。
- **Checkpoint 竞品结论**:Cline/Cursor 用 shadow git 快照、Aider 直接提交用户仓(被诟病)。**采纳 Cline 式 shadow repo,放弃我原来的"用户 .git 隐藏 ref"方案**(污染用户仓库且非 git 工作区无解)。

## 目录结构

```
D:\Projects\Glyphra-IDE
├─ package.json / pnpm-lock.yaml / vite.config.ts   # pnpm
├─ src/                          # React 19 + TS strict
│  ├─ app/            # 布局壳、theme(Mica/明暗)、i18n 初始化、错误边界
│  ├─ lib/
│  │  ├─ ipc/         # invoke/channel 薄封装 + gen/(ts-rs 产物,勿手改)
│  │  ├─ acp/         # AgentBus、TauriStream 桥、fixture 回放器、会话存档
│  │  └─ stores/      # zustand: project/editor/agent/review/ui
│  ├─ features/
│  │  ├─ editor/      # CM6 装配、tabs、语言懒加载、大文件降级
│  │  ├─ agent/       # 聊天流、工具卡、计划卡、审批弹窗、providers/(注册表+自定义 Provider 表单)
│  │  ├─ review/      # 变更队列、unifiedMergeView、turn 级还原
│  │  ├─ terminal/ tree/ search/ palette/ settings/ onboarding/ welcome/
│  └─ styles/
├─ src-tauri/                    # crate glyphra
│  ├─ src/{main.rs, state.rs}
│  ├─ src/ipc/        # 按域拆 commands: project fs gitx search agent pty vault settings update
│  ├─ src/agent/      # supervisor.rs framing.rs job.rs recorder.rs
│  ├─ src/gitx/       # cli.rs checkpoints.rs(shadow repo)
│  ├─ src/{pty.rs, search.rs, watcher.rs, vault.rs, settings.rs, perf.rs}
│  └─ tauri.conf.json / capabilities/
├─ fixtures/                     # ACP JSONL 录像 + replay-agent.mjs(假 agent)
├─ scripts/                      # smoke.ps1、size-check、bindings drift 校验
└─ .github/workflows/{ci.yml, release.yml}
```

## IPC 契约(ts-rs 导出类型;否决 tauri-specta 与纯手写)

**Commands**:`project_open/recent`、`window_open_project`;`fs_read/write(乐观锁)/list/watch_start`;`search_start(Channel<SearchBatch>)/cancel`;`git_status/diff_file/exec_readonly(白名单)`;`agent_spawn(Channel<AgentIo>)/write/kill/detect`;`ckpt_begin_turn/preimage/commit_turn/restore/diff`;`pty_open(Channel<Bytes>)/write/resize/close`;`vault_set/probe`(**永不回读明文**);`settings_get/set`;`update_check/install`;`perf_mark`。
**Channels**:AgentIo(agent stdout 行+exit/stderr)、Bytes(PTY,8ms 合帧)、SearchBatch(≤200 hits/批)、FsEvent(防抖)、更新进度。

## AgentBus 抽象(前端)

```ts
interface AgentBackend {  // 'codex-acp' | 'claude-acp' | 'pi-agent' | 'custom-agent' | 未来 'codex-appserver' | 'gemini-acp'
  spawn(project, provider): Promise<AcpConnection>;  // agent_spawn + TauriStream(~80行: Channel→ReadableStream, invoke←Writable) + sdk.client()
}
interface AgentSession {  // UI 唯一消费面,纯 ACP 语义
  prompt(blocks): Cancellable;
  events$: SessionUpdate 流;            // message_chunk / tool_call(+update) / plan / …
  onPermission(req => Promise<Outcome>); // 审批弹窗
  setMode(mode); load?(sessionId);       // 能力探测后启用恢复
}
```

- 客户端能力全开:`fs`(读写经 Glyphra → checkpoint 预像天然捕获)、`terminal`(转接 Rust pty)。
- 崩溃处理:exit → session 标记 crashed → "重启并恢复"(有 session/load 用之,否则新会话+本地存档只读回填);30s 内 3 崩熔断并展示 stderr 尾部。
- **fixture 录制/回放**:recorder.rs 落双向带时间戳 JSONL;replay-agent.mjs 按时序重放;vitest 以 Web Streams 直喂 SDK 断言 store —— **零 LLM 的确定性 UI 测试**,同一 fixture 供 Rust framing 单测复用。

## Provider / Auth(核心用户需求)

- 注册表:`codex: chatgpt-login | openai-key | custom-openai-compatible[n]`;`claude: subscription | anthropic-key`;`pi: pi-ai provider profile | cli login/profile`(基于 earendil-works/pi 的 `pi-ai`/`pi-agent-core`/`pi-coding-agent`);`custom-agent: acp | stdio-jsonl | shell-command`(任意外部 harness,字段含 command/args/env/protocol/cwd policy)。订阅登录态在各 CLI 自己家目录,Glyphra 不碰。
- Key 存 keyring(`glyphra/provider/<uuid>`),spawn 时 Rust 注入 env,前端仅 `vault_probe` 布尔。
- **自定义 Provider 物化**:首选 **`CODEX_CONFIG` env**(codex-acp 官方注入点):`{"model_providers":{"glyphra_<id>":{base_url, env_key:"GLYPHRA_PK_<id>", wire_api:"responses"}}, "model_provider":"glyphra_<id>", "model":…}` —— **零文件写入、~/.codex 分毫不动、进程退出即消失**[JSON schema 实现时复核]。兜底:独立 profile 文件 `~/.codex/glyphra-<id>.config.toml` + `--profile`。
- UI 必含**测试连接**(POST `{base_url}/responses` 最小请求)+ 显著提示"端点须支持 Responses API,DeepSeek 直连请经 LiteLLM/OpenRouter" + 内置 OpenRouter 预设模板。
- 权限预设:安全→read-only/default;标准→agent/acceptEdits(默认);放飞→agent-full-access/bypassPermissions(强确认+会话内红色横幅)。

## 里程碑(solo,各 1.5-2 周)

**M0 壳与编辑器**:git init+MIT+README;pnpm+Vite8+React19+TS strict+Tailwind4.2+create-tauri-app;Mica+decorum 标题栏(Win10 降级);CSS 变量主题(明/暗);布局壳(motion 过渡);project_open+最近项目;文件树(virtuoso+notify 增量);CM6(vscode-keymap、语言懒加载、明暗高亮);tabs+脏标记+乐观锁保存;大文件降级;设置骨架;i18n 骨架;ts-rs 管线+drift 校验;tracing 启动 spans+`--smoke` 模式(TTI+进程树 RSS 落 JSON);CI 三平台 build+clippy+vitest+smoke;size-limit。
→ **退出**:冷启动 <1.2s;空闲 RSS <150MB;首屏 JS <300KB gz;CI 绿。
→ **演示**:秒开 → 打开本仓库 → 开 3 文件切标签 → 切暗色 Mica 生效 → 切中文界面。

**M1 Agent 核心**:supervisor(spawn/env/framing/exit/win32job);TauriStream+sdk 接通;codex-acp 全链(initialize→authenticate→session/new→prompt);claude-agent-acp 同;`custom-agent` 兼容层(Pi/任意 CLI:命令模板、环境变量、stdio-jsonl/ACP 模式、record/replay);聊天 UI(virtuoso followOutput+streamdown 懒 chunk);工具卡状态机(pending/in_progress/completed/failed,diff/terminal 折叠);计划卡;审批弹窗(键盘 y/n/a);预设映射+setMode;recorder+真实 fixture 各一组;fixture 回放 vitest;Provider 注册表+vault+自定义 Provider 表单/测试连接/CODEX_CONFIG 物化;onboarding(agent_detect+winget/irm/自定义命令安装卡);会话存档 JSONL+列表(只读回填恢复)。
→ **退出**:两家真流跑通;fixture 测试零 LLM 全绿;1k tokens/s 注入不掉帧;自定义 Provider 经 OpenRouter 真连成功且 `~/.codex/config.toml` 校验和不变。
→ **演示**:onboarding 检出 CLI → "标准"预设让 Claude 小重构 → 审批写文件 → 切 Codex+OpenRouter 自定义端点 → 重启后会话列表可见。

**M2 评审与终端**:checkpoints.rs shadow repo(`GIT_DIR=%LOCALAPPDATA%/Glyphra/checkpoints/<hash>/git` + `GIT_WORK_TREE=<ws>` + 临时 GIT_INDEX_FILE;excludes 合并+嵌套 .git 探测);**三层预像:L1 ACP fs 写前捕获 / L2 git-clean 文件取 `git show HEAD:` / L3 turn 前仅快照脏文件集**;每 turn 粒度(非 Cline 的每 tool-call);评审队列(按 turn 分组,±徽标);unifiedMergeView 逐 hunk 接/拒(拒=还原该 hunk 落盘);turn 级整体还原(shadow checkout);与手工编辑共存(基线=预像,不锁文件);xterm 懒加载+webgl/回退+插件;pty.rs(ConPTY、8ms 合帧、job 归属);命令面板(cmdk);全局搜索(流式批推+虚拟列表+跳转);git 状态徽标;**IME 专项手测**;"编辑型 turn" fixture。
→ **退出**:50 文件 turn 快照 <1s;逐 hunk 回退字节级精确(fixture 断言);终端回显 p50 <16ms;10 万文件仓热搜 <1.5s;RSS <220MB。
→ **演示**:agent 改 6 文件 → 队列逐文件审 → 拒 2 hunk 收其余 → 终端跑测试 → 对 turn2 一键还原。

**M3 多窗口与发布**:welcome 窗口(最近/新建);多窗口(每项目一窗,supervisor 按 (windowLabel, sessionId) 路由,关窗级联 kill);single-instance(二次启动带路径→现存进程开新窗);会话恢复升级(session/load 能力探测);NSIS+图标品牌;portable exe;updater 全链(minisign 密钥、latest.json、staging 演练升级);release.yml(tag→三平台→草稿 Release);zh-CN 全量翻译;微动效打磨(面板滑入、卡片展开、流光标、reduced-motion);键位速查+最小自定义;熔断/stderr 展示打磨;设置页完整;THIRD-PARTY 许可清单(cargo-about + license-checker);smoke 预算收口。
→ **退出**:installer <30MB;冷启动 <1.5s(CI 实测);空闲 <250MB(1 项目+1 终端);v0.1→v0.2 自动更新在干净虚拟机成功;双窗会话互不串流。
→ **演示**:装 NSIS → welcome 开双项目双窗并行两 agent → 触发内置更新 → 中文界面完整走一轮评审。

## 多窗口方案

窗口 label:`welcome` / `proj-<xxh3(path)>`,启动 URL 带 `?project=`;Rust `AppState: DashMap<WindowLabel, ProjectCtx{procs, ptys, watchers, ckpt}>`;Channel 天然绑定发起窗口,无跨窗错投;CloseRequested → 运行中 turn 弹确认 → 级联清理(Job Object 兜底孙进程);全局单份 settings/vault/recent(文件锁)。

## 性能预算与 CI 守护(M0 起生效)

冷启动可交互 <1.5s(M0 目标 <1.2s);空闲全进程(含 msedgewebview2)<250MB;输入延迟 <16ms;首屏 JS <400KB gz(xterm、merge、streamdown+shiki、settings 全懒 chunk);installer <30MB。
CI(windows-latest 每 PR):release 构建 → `glyphra.exe --smoke` → 断言 TTI 与 10s 空闲 RSS → 趋势图;size-limit + NSIS 体积断言;rollup-visualizer 每里程碑复盘。

## 风险登记册

| # | 风险 | 缓解 |
|---|---|---|
| 1 | Codex 仅认 Responses API,DeepSeek 直连等不通 | 连接测试器前置报错;文案引导 LiteLLM/OpenRouter;内置 OpenRouter 预设 |
| 2 | ACP 适配器更名/破坏性变更(已发生过一次) | `npx <pkg>@<pinned>` 锁版;AgentBus 隔离;fixture 回归当金丝雀;升级独立 PR |
| 3 | WebView2+中文 IME+CM6 组合缺陷 | 锁最新 @codemirror/view;M2 IME 手测门禁;composition 期禁自定义 decorations |
| 4 | portable-pty ConPTY 标志缺失→resize 伪影 | 触发即切 psmux 补丁系/vendor;xterm DOM 回退 |
| 5 | 适配器需 Node ≥20,部分用户无 Node | onboarding 检测+winget 引导;roadmap:codex app-server 原生 Rust 客户端去 Node 化 |
| 6 | Windows codex sandbox experimental,"放飞"危险 | 安全语义靠审批策略;放飞档强确认+红色横幅;默认"标准" |
| 7 | 预算随功能堆积超标 | CI 门禁 M0 起红线;重库一律懒加载 |
| 8 | shadow checkpoint 巨仓/嵌套仓退化(Cline 已知痛点) | 三层按需预像只碰触碰文件;嵌套 .git 排除;>5MB 二进制跳过标注"无基线";超时熔断降级"仅展示不可回退" |

## 验证

每里程碑:`cargo test`(framing/checkpoints/搜索,复用 fixtures)+ `vitest`(store/组件/fixture 回放)+ CI smoke(预算)+ ts-rs drift + size-limit;里程碑末按"演示脚本"真机手测;M2 起固定 IME 检查单;M3 干净 Win11 虚拟机装/升级演练;tauri-driver e2e 冒烟可选不作门禁[Windows 稳定性实现时复核]。

## Roadmap(v1 后)

基础 LSP(懒启动,悬停/跳转/诊断)→ VSCode 主题导入(theme JSON→CSS 变量+CM6 高亮)→ Gemini CLI/OpenCode 接入(ACP 即插)→ codex app-server 原生 Rust 客户端(去 Node)→ git worktree 并行多 agent 会话看板 → MCP 管理器 UI → macOS/Linux 打磨 → SignPath 签名。

## 关键参考

ACP: github.com/agentclientprotocol/{agent-client-protocol,claude-agent-acp,codex-acp} · Codex: openai.com/index/unlocking-the-codex-harness、developers.openai.com/codex/config-reference、codex Discussion #7782(chat 移除) · Claude Code: code.claude.com/docs/en/headless、/setup · Tauri: v2.tauri.app(window Effect、IPC、updater) · Cline checkpoint: docs.cline.bot/core-workflows/checkpoints · streamdown: github.com/vercel/streamdown · CM merge: github.com/codemirror/merge
