# agent-faq — dtg 机制问答（agent 侧双通道）

> 面向 AI agent 的机制速查：读完本文即可回答关于 dsh-depth-tool-gate 的常见问题，并知道去哪查证。
> 人类向手册见 [panel-guide.md](./panel-guide.md)；字段字典见 [audit-schema.md](./audit-schema.md)。

## Q1: dtg 是什么？裁什么？
子代理上下文预算治理插件。三层：L1 工具面裁剪（`tools.restrict` deny/allow）、L2 提示遮蔽（prompt-slim）、L2.5 per-role 引导（role-briefs）。**裁的对象是工具面**（省每轮 tools 参数的 token 与误用面），不裁知识、不改模型。

## Q2: 主会话会被裁吗？
会。`main_deny`（config 一级键）对 **depth0 主会话**生效——只裁显式名单，新工具不波及主会话（autoDenyNew 不作用于 main）。`PROTECTED_MAIN`（18 件核心能力）**不是裁剪闸**：名单里含核心能力时**照裁**，只 warn 提醒后果（会话可能瘫）并记台账 `blockedProtected`——这是既定设计，用户明确要求"所有工具都应能在 preset 中禁用"。**只对之后创建或恢复的会话生效**（已开的不追溯）。典型用法：低频大定义工具按需裁（当前在裁：文生图三件 generate_image/generate_images/edit_image）。

## Q3: 同一工具能否主会话和子代理分别裁？
能，多套名单各管一层：`baseline_deny`（子代全局底线）→ `preset_extra_deny[preset]`（角色加裁）→ `preset_allow[preset]`（角色正面清单）→ `main_deny`（主会话）→ `main_preset_extra_deny[preset]` / `main_preset_allow[preset]`（主会话按角色）。同一工具名可出现在任意组合。

⚠ `preset_allow` 有**双重语义**，是本插件最容易踩的坑：
- 对**普通子代理**＝从禁用底线里**豁免**这些名（其余照常全裁）；
- 对**挂了 role-briefs 的 preset**（随包三个都挂了）＝**keep-only**（面就等于该清单）；
- 对**主会话**（未配 `main_preset_allow` 时回落共用键）＝**keep-only**，且 `main_deny` 不再叠加。

## Q4: preset 能被禁止派单吗？
能。`preset_deny`（数组）：名单内 preset 作为子代创建时被限制到最小回报面（note_search/send_message）并记台账 `preset-denied`（红行）；fail-closed（restrict 失败兜底 deny 全量已知工具，**绝不保留完整面**）；depth0 手开会话不受限（限的是派单链）；`list_agent_presets` 枚举同步隐藏（宿主 UI 的 preset 列表仍会显示）。⚠ 已知限制：子代仍会 spawn（占资源）后才被裁——入口前置校验是改进方向。

## Q5: 某工具为什么看不到？怎么自查？
调 `explain_gate`（只读工具，会话内 agent 调用）：返回可见数 + 被裁名单的原因归因（main_deny / baseline_deny / preset_extra_deny / preset_allow 清单外 / lock pending）。新工具首次出现会被 lock 闸门记 pending（autoDenyNew 默认拦截子代，主会话可见），需面板「闸门与发现」Tab 或 `rule` 裁决。

## Q6: 工具调用频率哪里看？
面板「📊 调用频率」Tab 或网关方法 `usageStats()`：per-tool 总量 + per-preset 分桶 + 最近 40 个会话的明细。数据=dtg 自采（`session/event` 的 `tool/call` 事件，O(1) 内存计数，键上限 4096，超限归并 `__overflow__`），快照落盘 `depth-tool-gate.usage.json` → **重启不清零**；不落 arguments（敏感+体积）。口径=调用尝试次数（不分成败）。

## Q7: dispatch_composed / 能力标签是什么？
动态最小工具面派单：`capabilities=["literature","reader"]` 标签取并集 → spawn 子代 + `restrict({allow})` keep-only（面外一切不可见，未来新工具自动不可见）。标签表=config `capabilities`（存在且非空时整体覆盖内置；内置 5 个：reader 8 件 / reader-lead 9 件 / ocr 9 件 / literature 22 件 / literature-lead 23 件）。标签写错=**直接失败**并列出可用标签；标签内的 MCP 工具缺失时只丢 MCP 件、其余保留（降级而非空面）。dispatch_composed 本身不进子代默认 baseline。

**并行**：传 `tasks[]` 可一次派出多个独立子代（各有自己的 prompt 与自己的面，互不等待）——例如同时读三篇论文。顶层 `prompt`/`capabilities`/`tools` 作各任务的默认值。

**异步**：默认**立即返回**各子代理 id，不等它们跑完；每个子代完成时结果由宿主作为一条消息投递给本会话（与宿主原生 `subagent` 工具同范式）。需要当场拿结果再继续时才传 `wait=true`（会阻塞到全部完成）。

**续派不变面**：给已跑完的子代续派任务时，宿主冷恢复并重新物化它；闸门重新施加**同一份** allow 名单，不会落回通用 deny 名单 —— 工具面不会在一段持续的对话中途变掉。台账里该子代的 `claimCount>1` 即表示被续派过。

## Q8: 裁剪出了问题怎么排查？
见 [troubleshooting.md](./troubleshooting.md)。核心口诀：**静默降级=最危险**（v0.8.2 起 role-brief 缺失记台账 `role-brief-missing` 可查）；面板 7 Tab 逐层对账（配置清单 vs 运行时发现 vs lock 状态 vs 台账事实）。

## 权威数据源
- 配置：`~/.dsh/profiles/web/depth-tool-gate.config.json`（热读，保存即生效）
- 台账：`~/.dsh/logs/depth-tool-gate/audit.jsonl`
- lock：`~/.dsh/logs/depth-tool-gate/depth-tool-gate.lock.json`（版本闸门，pending/denied/allowed）
- 运行时：面板（设置→子代理工具面）或 `explain_gate` 工具
