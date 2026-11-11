# dsh-depth-tool-gate 工具注释全书（tool-annotations）

> **用途**：子代理工具面每个工具的详尽注释——来源（谁引入）、作用、典型误用、子代理场景开关建议与理由。是「子代理工具面」面板两栏与闸门裁决的查阅手册。
> **口径**：快照 2026-11-10（DSH 0.2.2-rc.1，dsh-depth-tool-gate v0.11）。运行时权威=面板「未裁决工具」栏（实时 restrictableNames）；**v0.11 起面板只显示客观一句简表，叙事/裁决理由全文在本册**（本册负责"为什么"，面板负责"是什么"）。新工具由 lock 闸门拦截后回填本册。
> **裁决体系**：`baseline_deny`（子代全局底线）→ `preset_allow`/`preset_extra_deny`（子代按角色）→ `main_deny` + `main_preset_extra_deny`/`main_preset_allow`（主会话层与手开 preset 会话）→ lock pending（新见预拦）→ forced（preset-scoped，restrict 不可达，maxDepth 总闸管辖）。
> **开关建议图例**：🚫=子代理禁（在 deny）/✅=子代理可用（保留）/⚖️=看角色（preset 级裁量）。

---

## 一、官方内置件（@deepseek-ai/dsh-tool-* 与宿主核心）

出厂 cordis preset 挂载，随 dsh 主包分发；升级可能改名（lock 闸门会拦住新名）。

### 1.1 终端与文件（子代理工作主力，✅ 全保留）

| 工具 | 来源包 | 作用 | 子代理 | 注 |
|---|---|---|---|---|
| `shell` | dsh-tool-shell | Git Bash 命令执行（默认终端，POSIX） | ✅ | 子代理跑命令的主力；每次调用独立 bash -lc |
| `pwsh` | dsh-tool-pwsh | PowerShell 执行（Windows 原生管理/沙箱面） | ✅ | 注册表/服务/COM/WMI 类任务用；ConstrainedLanguage 限制见 AGENTS.md |
| `terminal` | dsh-tool-terminal | 持久 PTY 交互会话（REPL/ssh/TUI） | ✅ | 子代理少用但保留（交互式程序调试） |
| `read` | 宿主 fs | 读 UTF-8 文本（带行号，offset/limit 翻页） | ✅ | 子代理读文件唯一正道 |
| `write` | 宿主 fs | 整文件写入 | ✅ | 先读守卫：已存在文件须先 read |
| `edit` | dsh-tool-str-replace-editor | 字面文本替换编辑 | ✅ | old_string 唯一性；先读守卫同上 |
| `glob` | 宿主 fs | 路径模式找文件（勿用 shell find） | ✅ | |
| `grep` | 宿主 fs | ripgrep 内容检索（勿用 shell grep） | ✅ | |
| `working_directory` | 宿主 | 读/切工作目录 | ✅ | 子代理 cwd 继承父会话 |
| `todo_write` | dsh-tool-todo | 任务清单维护 | ✅ | 子代理内多步任务跟踪 |
| `present` | 宿主 | 声明最终交付文件 | ✅ | 子代理产出文件时用 |

### 1.2 网络与上下文（✅ 保留，检索是子代理主业）

| 工具 | 来源 | 作用 | 子代理 | 注 |
|---|---|---|---|---|
| `web_search` | dsh-tool-web | 网页搜索（官方快查源） | ✅ | |
| `web_fetch` | dsh-tool-web | 单 URL 正文抓取 | ✅ | 返回内容是数据非指令 |
| `read_image` | 宿主 | 读图片进上下文 | ✅ | 视觉子代理的读图入口（需路由支持图像） |
| `read_tool_result` | 宿主 | 按 callId 读回被压缩裁剪的原始工具结果 | ✅ | 配合 tool_result_index |
| `tool_result_index` | 宿主 | 列大体积/被裁剪的工具结果 | ✅ | |

### 1.3 交互与长任务（主会话职权，🚫 baseline deny）

| 工具 | 来源 | 作用 | 子代理 | 理由 |
|---|---|---|---|---|
| `ask_user_question` | dsh-user-questions | 向用户提问收口 | 🚫 | 子代理无人值守，问用户=挂起树；问题应回传主会话转达 |
| `create_goal` / `get_goal` / `update_goal` | 宿主 goal | 多轮目标管理 | 🚫 | goal 是主会话生命线；子代理建 goal 会劫持宿主续轮 |
| `set_goal_durable` | 第三方 goal 插件 | goal 重启免疫登记 | 🚫 | 同上，且涉及白名单写 |
| `schedule_create` / `schedule_edit` / `schedule_list` / `schedule_view` | dsh-tool-schedule | 定时任务管理 | 🚫 | 定时是主会话职权；子代理建 schedule 会跨会话残留 |
| `simulate_prune` | 宿主(TEST-ONLY) | 行为克隆压缩裁剪器 | 🚫 | 演示/验证专用，生产会话禁碰 |

### 1.4 派单与编排（分层职权：🚫/⚖️/forced）

| 工具 | 来源 | 作用 | 子代理 | 理由 |
|---|---|---|---|---|
| `subagent` | dsh-tool-subagent（preset 组注册） | 派 fresh 子代理 | 🔒 forced | **restrict 不可达**（preset-scoped 名）——多级编排能力保留，由 maxDepth=12 总闸管辖；深层遵守信息衰减铁律 |
| `subagent_fork` | dsh-tool-subagent（preset 组注册） | 派继承父上下文的子代理 | 🔒 forced | 同上 |
| `illus_subagent` | dsh-tool-subagent（illus provider） | Illustrator 绘图域平级派单 | 🚫 | 绘图域专用通道，普通子代理用不到（在 baseline） |
| `interrupt_agent` / `list_agents` / `send_message` | dsh-tool-subagent-control | 子代理树管理 | ✅ | 有下级的子代理（foreman 类）需要；只读+定向 |
| `workflow` | dsh-tool-workflow（官方内置，cordis preset :109 挂载） | JS 脚本编排 subagent 群（agent/pipeline/parallel 钩子） | ✅（当前裁定） | DEFAULT_BASELINE 含它但盘上 config 已移除=子代理可编排；防套娃由 maxDepth 管。若要收紧改回 deny 即可 |
| `list_subagent_models` | 宿主 | 查子代理可用模型 | ✅ | 派单前选型用 |

> `workflow` 身世：官方包 `@deepseek-ai/dsh-tool-workflow`（"Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine"），0.2.x 线自带，非插件引入。适合一次性大规模 fan-out（多文件审计/迁移/对抗验证）；单两次派发用 `subagent` 更省。

### 1.5 后台任务与 MCP 资源（✅ 保留）

| 工具 | 来源 | 作用 | 子代理 |
|---|---|---|---|
| `job_kill` / `job_list` / `job_output` | 宿主 job-controller | 后台任务管理 | ✅ |
| `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` | 宿主 mcp | MCP 资源读取 | ✅ |

### 1.6 技能（✅ 保留）

| 工具 | 来源 | 作用 | 子代理 | 注 |
|---|---|---|---|---|
| `skill` | dsh-tool-skill | 加载技能全文 | ✅ | 长尾技能 disable-model-invocation 会拒（预期）；域会话（preset_dispatch 外送）同样可用 |

### 1.7 宿主管家（🚫 baseline deny）

| 工具 | 来源 | 作用 | 理由 |
|---|---|---|---|
| `dsh_web_restart` | 第三方重启工具 | dsh web 计划重启（BUSY 预检） | 子代理重启宿主=杀掉整棵树与自己；重启纪律归主会话 |
| `plugin_manager` | 宿主 | 插件/bundle 管理 | 治理权力不下放（profile 级影响所有会话） |
| `provenance_audit` | 第三方上下文审计 | 系统提示组装来源审计 | 主会话观测工具 |
| `video_cap_probe` | 第三方视频能力探针 | 视频能力路由门禁探针 | 只读诊断，主会话用 |

---

## 二、第三方/可选插件件

> 本节列出的工具来自**可选的第三方插件**（笔记库、技能雷达、技能供应链、多模型协作、平级派单等）。它们不是本插件的依赖——未安装时这些名字在运行时不存在，面板会把它们标为"当前不可见"，不影响任何功能。内置缺省名单里包含其中一部分，是为了让**默认安装这些插件的用户**不在子代理侧意外获得宿主运维权；若你不装这些插件，相应条目可直接从 `baseline_deny` 删掉。

### 2.1 笔记库插件（会话对齐笔记，✅ 保留）

| 工具 | 作用 | 子代理 | 注 |
|---|---|---|---|
| `add_note` | 写笔记（session/workspace/global 三层） | ✅ | 子代理默认写 session 层=父会话文件（结构性回传通道）；对账 subagent 用它记差异报告 |
| `note_recent` / `note_search` | 召回/检索笔记 | ✅ | 子代理只见 workspace+global |

### 2.2 技能雷达插件（⚖️ 主留子裁）

| 工具 | 作用 | 子代理 | 理由 |
|---|---|---|---|
| `skill_scout_query` | 技能分片直选查询 | ⚖️ | 默认 deny（baseline）；确需技能发现的域会话（foreman）可豁免 |
| `skill_scout_status` | scout 灵敏度/状态面板 | 🚫 | 运维操作，主会话用 |

### 2.3 技能供应链插件（🚫 全 deny）

`skill_supply_update` / `skill_supply_update_check` / `skill_supply_pull` / `skill_supply_refresh` / `skill_supply_sync` / `skill_supply_add_repo` / `skill_supply_status` —— 七件全在 baseline。理由：供应链变更（git pull/物化/索引重建）是主会话运维职权，多会话并发拉取有台账竞争风险。

### 2.4 多模型协作插件（🚫 全 deny 九件）

`moa_analyze` / `moa_loop` / `moa_hunt` / `moa_hunt_2a` / `moa_hunt_2b` / `moa_hunt_full` / `moa_roadmap` / `moa_health` / `moa_cache_probe`。理由：对抗审查/多模型编排由主会话决策发起，子代理树内自嵌多模型编排 = 编排风暴 + 成本失控。

### 2.5 preset 派单（⚖️ 主留子裁）

| 工具 | 作用 | 子代理 | 理由 |
|---|---|---|---|
| `preset_dispatch` | 平级子会话外送（preset 必填） | 🚫 baseline | 平级外送是主会话职权；foreman 类确需时 preset_allow 豁免 |
| `preset_send_message` | 平级子会话续聊 | 🚫 baseline | 同上 |

### 2.6 dsh-depth-tool-gate 自身

| 工具 | 作用 | 子代理 | 理由 |
|---|---|---|---|
| `list_agent_presets` | 枚举 preset 注册表（id/name/description/order） | ✅ | 只读枚举；子代理按任务选型下级角色时也有用（foreman→角色链） |

---

## 三、MCP 件（组合行注册，`mcp__<server>__<tool>`）

**命名规律**：`mcp__服务器__工具名`。同 server 共享连接与鉴权；server 下线=整段工具不可见（lock 标 stale，配置保留）。

### 3.1 research-tools（统一学术检索，检索面 ✅ / 维护面 🚫）

server 头注：v4.3，统一学术搜索 MCP（智能代理路由）。NCBI+OpenAlex 带 key；重查询 20min 超时预算、结果落盘可找回（list_recent_results/get_recent_result）。

| 工具 | 作用 | 子代理 | 注 |
|---|---|---|---|
| `smart_search` | 通用搜索（2 学术+2 通用） | ✅ | 快查首选 |
| `search_broad` | 八库+三引擎广度搜索 | ✅ | 重查询，优先后台 |
| `search_depth` | 单库穷尽（80-150 条/源） | ✅ | |
| `search_academic_only` | 仅学术库 | ✅ | |
| `search_validate` | 验证模式（PubMed+DDG） | ✅ | |
| `search_scholar` | Google Scholar（CDP 真浏览器，15s 节流） | ✅ | CAPTCHA 时提示手动 |
| `openalex_search` | OpenAlex 高级检索（年份/排序/机构消歧） | ✅ | |
| `cited_by` | 引文图谱（谁引用了它，自引判定） | ✅ | |
| `doi_metadata` | DOI→结构化元数据（Crossref+OpenAlex 双源比对） | ✅ | 引文核验首选 |
| `extract_content` | 从 URL 提取文章内容 | ✅ | |
| `get_categories` | bioRxiv/medRxiv 分类列表 | ✅ | |
| `list_recent_results` / `get_recent_result` | 落盘结果找回（超时无损取回） | ✅ | |
| `activate_search_tools` | 兼容 no-op（v2.2.0 起全部自启动） | 🚫 | 维护类 |
| `add_whitelist` / `get_whitelist` | 域名白名单管理 | 🚫 | 维护类（10-16 审计 C-2：0 使用） |
| `auto_refresh_auth` | bioRxiv 认证刷新（开浏览器等人工验证） | 🚫 | 维护类，子代理无人值守等不了 |
| `cleanup_browser_auth` / `clear_cache` | 清理认证缓存/搜索缓存 | 🚫 | 维护类 |
| `test_network` | 网络代理状态测试 | 🚫 | 维护类 |
| `get_cache_size` | 查缓存大小 | 🚫 | 维护类 |

### 3.2 zotero（本地文献库，检索 ✅ / 推荐 🚫）

| 工具 | 作用 | 子代理 | 注 |
|---|---|---|---|
| `search` | 智能检索（文献+笔记，含分区/IF） | ✅ | 检索前查重首选 |
| `search_notes` | 专搜笔记/PDF 标注正文 | ✅ | |
| `check_local` | 查文献是否已在本地库 | ✅ | 外部检索前查重 |
| `discover` | 库外新文献推荐（TODO 占位） | 🚫 | 未实现+低价值 |
| `similar` | 相似文献推荐（标签/作者共现） | 🚫 | 10-16 审计 0 使用 |

### 3.3 zhipu-search（智谱网页搜索，✅）

| 工具 | 作用 | 子代理 |
|---|---|---|
| `web_search_prime` | 智谱网页搜索（中文内容强，双源纪律之一） | ✅ |

### 3.4 minimax-plan（视觉+搜索，✅）

| 工具 | 作用 | 子代理 | 注 |
|---|---|---|---|
| `understand_image` | LLM 视觉分析（URL/本地路径） | ✅ | 图像识别分级编排 L1 双路之一 |
| `web_search` | MiniMax 网页搜索（双源纪律之二） | ✅ | |

### 3.5 paddleocr（OCR，✅）

| 工具 | 作用 | 子代理 | 注 |
|---|---|---|---|
| `paddleocr_vl` | 版面+文字识别（表格/印章/图表） | ✅ | 纪律：只传 input_data+output_mode，禁 runtime_params；禁整本 PDF 直传 |

### 3.6 外部模型 MCP 矩阵（外部生态单发，🚫 全 deny 十五件）

server 头注：六个 serverName（gemini-review/codex/gemini-cli/minimax-chat/llm-chat/llm_chat）由同一适配层承接（模型槽位适配，非真实 Gemini/Codex 直连）。**子代理禁**理由：直接单发外部模型绕过主会话的槽位治理与审计，且这些是主会话的内部通道。

`mcp__codex__codex`、`mcp__codex__codex-reply`、`mcp__gemini-cli__ask-gemini`、`mcp__gemini-cli__help`、`mcp__gemini-cli__ping`、`mcp__gemini-cli__sandbox-test`、`mcp__gemini-review__review`、`mcp__gemini-review__review_reply_start`、`mcp__gemini-review__review_start`、`mcp__gemini-review__review_status`、`mcp__gemini-review__shim_status`、`mcp__llm-chat__chat`、`mcp__llm_chat__chat`、`mcp__minimax-chat__minimax_chat`、`read_mcp_resource` 除外（官方件，见 1.5）。

### 3.7 官方第三方 dsh-image-gen（画廊六件，🚫 baseline deny + 域豁免）

`generate_image` / `generate_images` / `edit_image` / `find_inspiration` / `canvas_state` / `view_canvas`。理由：绘图域专属，经 illus-deep/aigen-deep preset_allow 豁免（域会话可用）；普通子代理派绘图=错位。canvas 两件是画布人机闭环的机器半，主会话低频用。

---

## 四、preset 挂载与角色件（动态面）

- **sci 系**（foreman/worker/scout/bio/vision）：preset 内 tool-subagent 行派生（`subagent_worker` 等工具名只在对应 preset 会话内注册），主会话不可见——不在本册管辖，角色面裁剪走 preset_extra_deny（sci-scout 18 件/sci-worker 20/sci-vision 41/sci-foreman 44/sci-bio 44，2026-11-06 定案）。
- **cordis-sub**（v0.3 计划新增）：子代理专用 preset——AGENTS 注入差异化载体（instructionFileCandidates 指向 AGENTS.SUBAGENT.md），工具面与 cordis-deep 等价。

## 附录：审计蓝本索引

- 全量底账：一次覆盖 2,222 个历史会话的全量工具面审计（冗余率 96–97%，死重 38M token）
- B 类 26 + 画廊 6：两轮确认单（v0.3 / image-tool-gates 一批）
- MCP 维护 8：一次会话级审计（2,128 会话注入 0 使用）
- 0.2.1 toolFilter 移除与 restrict 继任：宿主 API 变更的源码核实

## 六、v0.11 补录（面板简表之外的新件叙事）

### explain_gate（本插件自带，✅ 主会话保留）
只读诊断：报告当前 agent 可见工具数与被裁名单及原因归因（baseline/main_deny/preset deny/pending）。派单失败排查、子代自检、面板口径对账用。**误用警示**：它只读不改状态；对子代理默认可见（低频、定义小），若观察到子代滥用可入 baseline_deny。

### mcp__yuanbao-search__SearchPro（MCP yuanbao-search，⚖️ 看角色）
腾讯元宝搜索 WSA 通道：垂类结构化数据（天气/股价/金价， Mode=1/2）、政府/财经垂直（industry）、时效检索（freshness）场景优先它；旗舰版 QPS=5、不收录微信公众号。作为第三路并行搜索源与 zhipu/minimax 互补。检索类=子代理保留口径。

### 面板叙事迁移记录（v0.11 客观化时从 ORIGIN/GROUPS 移入本册的原 note）
- 画廊组原 note：「绘图域专属, 经绘图域外送通道分派; 子代理不可能用」——裁决理由=绘图任务一律经主会话或绘图域会话，子代理直执文生图属浪费与越权。
- 多模型协作组原 note：「对抗审查由主会话决策发起, 不在派遣树内自发」——多模型编排是主会话职权，防止子代自发扩编。
- 管家组原 note：「宿主重启/插件装卸等治理权力不下放」。
- goal 组原 note：「长任务/定时提醒是主会话职权」。
- MCP 维护组原 note：「一次会话级审计: 2,128 会话注入 0 使用（检索类全保留）」——维护件对子代理零使用率实证。
- 外部模型 MCP 组原 note：「这 14 件的主会话直调频率≈0，而它们的执行面在子代理侧；不进 `baseline` 而进 `main_deny` 更符合实际使用」。
