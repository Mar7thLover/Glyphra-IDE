# Git 审阅体验 — UX 蓝图（TODO 计划）

> 状态：**R1 基本完成 · R2/R3 计划中**（执行清单见 [TODO.md](./TODO.md) P1）。  
> 前置：M2 已有 checkpoint 引擎（shadow repo）、ReviewPanel（逐 hunk 接/拒）、MergeEditor、gitStore 状态徽标。  
> 视觉语言：沿用 Aurora Glass 体系（`glass-float` 浮层、`Notice` 卡、`PillSelect`、`thinking-bar`）。  
> 最近核对：2026-07-21。

## 目标

把「审阅」从一个面板升级为 Glyphra 的核心工作流：**任何改动（agent 回合或手工 git 变更）都能舒适地读、快速地裁决、并随时把一段代码交给 agent 复审或改写**。保持轻量：不引入重型 SCM 面板，一切围绕"读—裁决—驾驭"。

## 1. 审阅中心（Review Center）重塑

- **入口统一**：状态栏审阅 pill（现有 turn 计数）+ `Ctrl+Shift+R` + 命令面板；有未裁决变更时 pill 显示琥珀点徽标。
- **队列呈现**：右侧滑入的玻璃浮层（与 Agent 面板同宽体系），按 **turn 分组**的变更队列：
  - 组头：turn 标签（prompt 摘要前 48 字）、时间、文件数、`+/-` 行数徽标、「还原整个回合」。
  - 文件行：路径截断中置省略、状态色点（A 绿 / M 琥珀 / D 红）、hunk 计数、逐文件「保留 / 还原」。
  - 已裁决文件淡出收拢（保留可展开的审计痕迹），全部裁决后组头打勾并折叠。
- **裁决流键盘化**：`j/k` 文件间移动、`Enter` 打开 merge 视图、`a/r` 接受/拒绝当前 hunk、`Shift+A` 整文件保留。目标：一次不碰鼠标完成整轮审阅。
- **手工 git 变更纳入**：除 agent turn 外，增加「工作区变更」虚拟组（`git status` 驱动，diff 基线 = HEAD），使 Glyphra 也能当轻量 diff 工具用。

## 2. 逐 hunk 视图打磨

- MergeEditor 外框玻璃化、hunk 间距加大；接受/拒绝按钮换成本次重塑的 pill 风格并带 `motion` 微动效（接受→绿色收拢，拒绝→红色划除）。
- 顶栏：文件路径面包屑 + hunk 进度（3/7）+「在编辑器打开」。
- 大文件/二进制：沿用降级策略，显示「无基线，仅展示」占位卡。

## 3. 随时呼叫 Agent 审阅选中代码（核心新能力）

- **选区浮动操作**：编辑器内选中代码 → 光标尾部浮出小玻璃胶囊 `✦ Agent`（快捷键 `Ctrl+L`），菜单：**审阅这段 / 解释这段 / 重写这段 / 补测试**。
- **上下文注入**：把 `文件路径 + 选区行号 + 选区文本（超限截断）` 作为结构化引用块填入 Agent composer（面板未开则自动打开），显示为可删除的 `@file:12-40` 引用芯片 —— 与 ACP prompt 的 resource 语义对齐。
- **审阅结果结构化**：约定 agent 以「审阅意见」清单回复时，前端解析为 **ReviewCommentCard**：严重度色点、定位（点击跳转编辑器并高亮行区间）、建议 diff（有则显示「应用」按钮 → `ckpt_write_file` 落盘并进入审阅队列）。解析失败则原样走 markdown，零风险降级。
- **审阅会话隔离**：来自选区的审阅默认在 `safe`（只读）模式的轻量会话中进行，不打断当前主会话（后端支持多会话后启用；初版复用当前会话）。

## 4. 行内呈阅（Inline Review）

- 编辑器 gutter：有未裁决 hunk 的行显示 2px 侧色条（agent 改动 = 品牌紫，手工 = 琥珀）；点击弹出行内玻璃卡：mini diff + 接受/拒绝 + 「问 Agent」。
- ReviewCommentCard 锚定到行：以折叠的「评论点」呈现，hover 展开，处理后自动消失。
- 所有行内浮层复用 `glass-float` + `pop-in`，支持 `Esc` 关闭、`prefers-reduced-motion` 降级。

## 5. Git 辅助（轻量，不做完整 SCM）

- 状态栏左侧加分支名 + ahead/behind 徽标（`git_exec_readonly` 白名单已支持）。
- 「提交辅助」：审阅队列全部裁决后出现「生成提交信息」按钮 → agent 依据已接受 diff 起草 commit message → 用户确认后 `git add -A && git commit`（需为 gitx 增加受控写命令 `git_commit`，白名单严格限定）。
- 明确非目标：branch 管理、push/pull UI、冲突解决器（v1 之后再议）。

## 6. IPC / 数据需求（新增）

| 命令 | 用途 |
|---|---|
| `git_diff_file(project, path, base)` | 工作区变更组的逐文件 diff（base=HEAD） |
| `git_commit(project, message)` | 提交辅助（受控写，白名单+确认弹窗） |
| `ckpt_hunks(project, turn, path)` | 预计算 hunk 边界与 `+/-` 统计，供队列徽标 |
| ACP resource 引用 | composer 引用芯片 → prompt blocks（SDK 已支持） |

## 里程碑拆分

- **R1 队列与键盘流** ✅：审阅中心重塑 + `+/-` 徽标 + 键盘裁决 + 手工变更组（只读 diff）+ `git_diff_file` / `ckpt_hunks`。
- **R2 选区呼叫 Agent** 🔶：上下文菜单「附加选区」与 composer 引用芯片已有雏形；缺浮动 `✦ Agent` / `Ctrl+L` 胶囊与 `ReviewCommentCard` 解析/跳转。
- **R3 行内呈阅与应用** ⬜：gutter 色条 + 行内卡 + 建议 diff 一键应用 + 提交辅助 + `git_commit` + 分支 ahead/behind。

## 风险

1. agent 回复的审阅结构无法稳定解析 → 以「宽松解析 + markdown 降级」兜底，并在 prompt 模板中固定输出格式。
2. 行内浮层与 CM6 装饰系统的性能/IME 冲突 → 复用 M2 IME 门禁清单，composition 期间禁用浮层。
3. `git_commit` 属首个写命令 → 独立 capability、双重确认、审计日志（gitx 层记录完整命令行）。
