# 新用户开箱框架（Router–Worker 两层）

> **本文用途**：装完 `dsh-depth-tool-gate` 后，**不读任何其它文档**也能知道——
> 自己拿到的是什么框架、有哪些角色、谁管谁、工具面长什么样、怎么派活、边界在哪。
>
> **权威源纪律**：本文所有事实取自**随包文件**（`cordis.patch.yml` / `config.default.json`
> / `agents-briefs/` / `host.v2.mjs`），逐条可复核。本文若与代码不符 ⇒ **以代码为准**。
>
> **姊妹文档**：治理语义与配置键 → `preset-policy.md`；工具说明机制 → `tool-annotations.md`；
> 未来演进项（沟通拓扑等）→ `roadmap.md`。

---

## 1. 一句话概括

装上这个包，你得到的是一套 **「零执行 Router + 全执行 Worker」的两层架构**：

```
┌────────────────────────────────────────────────────┐
│  cordis-router（主会话）                            │
│  · 零执行：没有 read / write / shell / web_search    │
│  · 只有：派单系 + todo + ask_user_question           │
│    + web_fetch(仅 fetch) + skill                    │
│  · 职责：承接用户 → 判断分派 → 汇总 → 对用户负责    │
└───────────────────┬────────────────────────────────┘
                    │ 派单（subagent / dispatch_composed / workflow）
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │Worker 1 │ │Worker 2 │ │Worker N │   ← cordis-sub 或动态组装面
   │全工具执行│ │全工具执行│ │按标签组装│
   └─────────┘ └─────────┘ └─────────┘
                    │
                    ▼  回执(结论先行) ──→ Router 汇总 ──→ 用户
```

**关键设计**：Router **碰不到工具**，所以它**只能**派单；Worker **什么都干**，但**只对 Router 汇报**。
这条「零执行纪律」不是建议，是**面级强制**（工具压根不注册在 router preset 行里）。

---

## 2. 随包发了什么（发布态 **3 个 preset**）

包内 `cordis.patch.yml` 在**发布导出时经过 core3 裁剪**（`release-export.mjs` 的 T2.5：
只保留 `preset-cordis-router` / `preset-dtg-shell` / `preset-cordis-sub` 三段，其余整段切除）。

⇒ **新用户拿到的是 3 个 preset**（仓库源码里有 4 段，多出的 `sci-lite` 在导出时被裁掉）。
本地 profile 自己加的域 preset（`sci-*` / `illus-deep` / `word-deep` / `excel-deep` /
`ppt-deep` / `gallery-deep` / `paint-deep` / `aigen-deep` / `cordis-deep-ptc` / `moa-*`）
**不随包发布** —— 它们属于你的 profile，不属于这个包。

| preset | 定位 | 工具面 | 能否再派 |
|---|---|---|---|
| **`cordis-router`** | 纯编排主会话 | 派单系 + todo + ask + web_fetch + skill + compaction + prompt-slim + role-brief。**零执行**（无 read/write/shell/web_search/MCP） | ✅ 能派（`maxDepth: 12`） |
| **`cordis-sub`** | spawn 派生子代理专用 | 执行全件（bash/pwsh/fs/fs-search/jobs/goal/planning/compaction/web/skill/present…）+ delegation 组 + role-brief | ✅ 能派（`maxDepth: 12`，可多级级联） |
| **`dtg-shell`** | 动态组装空壳 | **零工具行** —— 工具面全由 `dispatch_composed` 的 allow 名单组装 | ❌（面由派单方给定） |

★ 仓库态的第 4 段 `sci-lite`（文献速查细粒面）**不在发布态** —— 想用文献速查，
新用户自己配 `capabilities` 标签（见 §3.3）或自建 preset。

### 2.1 `cordis-router` 的面（逐行可核）

```
persona / role-brief / time-context
compaction(compaction-basic + command-compact + tool-result-pruner)
delegation( tool-subagent-control + tool-subagent + tool-subagent-fork
           + workflow-ptc + tool-workflow )
tool-todo
tool-ask-user          ← 启用（router 的唯一交互出口）
tool-web               ← fetch: true, search: false
skill-filesystem / tool-skill
prompt-slim
```

**为什么 `search: false`**：router brief 明确「不检索库(web_search/MCP)」⇒ 只留 `web_fetch`
（用户消息带链接时看一眼以判断派单）。

### 2.2 `cordis-sub` 的面（逐行可核）

```
persona / role-brief / time-context
tool-bash / tool-pwsh / tool-fs / tool-fs-search / tool-jobs
tool-schedule / command-goal / tool-goal
planning(plan-mode) / compaction(compaction-basic + command-compact + tool-result-pruner)
delegation( tool-subagent-control + tool-subagent + tool-subagent-fork
           + tool-subagent-illus[disabled] + workflow-ptc + tool-workflow )
tool-ask-user         ← ★ disabled: true（子代**不注册**问用户工具）
tool-todo / tool-web / tool-cordis / skill-filesystem / tool-skill / present
tool-plugin-manager / prompt-slim
```

★ **`tool-ask-user` 在 `cordis-sub` 是 `disabled: true`** —— 意味着**新用户的子代从一开始就
没有 `ask_user_question`**。这是开箱即符合「子代不许直接问用户」的：子代缺信息时**回报父级**，
由父级决定是问用户还是自己答。（本机生产 profile 后来在**治理层**又加了一道，见 §5.3。）

---

## 3. 派活方式与决策面

### 3.1 `subagent` —— 派一个 Worker，继承父级工具面

```jsonc
// router 会话里
{ "prompt": "任务书全文", "description": "短标签", "provider": "spawn" }
```

- 落点 preset = **`cordis-sub`**（`agentPreset: cordis-sub`，随包 patch 里写死）
- 继承父的上下文（`subagent_fork`）或全新上下文（`subagent`）
- `maxDepth: 12` ⇒ 最多 12 层嵌套

### 3.2 `dispatch_composed` —— 按**能力标签**组装一个临时面

```jsonc
{ "prompt": "任务书", "capabilities": ["reader"], "description": "标签" }
```

- 标签来自 `config.capabilities`；**缺省走内置表**（新用户即下列 5 个）
- 标签 = **整面**，不用逐件写工具名（省 token）
- 可 `tools: [...]` 直传单件作补丁
- 落点 preset = **`dtg-shell`**（零工具行，面全由 allow 名单组装）
- 未知标签 = **硬失败**（报 `未知能力标签: <tag>` + 可用清单），不静默回落

### 3.3 内置能力标签表（5 个）

| 标签 | 件数 | 内容 |
|---|---|---|
| `literature` | 24 | research-tools 检索族 + zotero + web + 文件 + todo |
| `reader` | 10 | web(fetch/search) + 文件 + 图像 + todo |
| `reader-lead` | 11 | reader + `dispatch_composed`（可再派一级孙代） |
| `literature-lead` | 25 | literature + `dispatch_composed` |
| `ocr` | 11 | paddleocr + minimax 视觉 + 文件读写 + todo |

★ **每个标签都含 `describe_tools`** —— 子代理在调用前可查「这件工具到底能干什么」
（完整说明，非截断短描述）。见 `tool-annotations.md`。

★ **每个标签也都含 `explain_gate`** —— 只读诊断：报告「可见 N/M、被裁 K 件」+ 每件
**被哪条规则裁的**（baseline_deny / main_deny / preset_extra_deny / 正面清单外 / lock pending /
别的 preset 自带未挂载）。它是「缺工具先自查」这条铁律能被执行的**前提**：组装面是
**keep-only allow 名单**，面外一律不可见 ⇒ 标签里没有 `explain_gate` 时，组装出来的子代理
只能回一句「没有这个工具」—— 缺了归因，主会话无法定位。
（它是只读工具、自身不受所报闸门约束、且不在底线清单里 ⇒ 带上它零治理风险。）

### 3.4 能力标签目录（决策面不需要 schema）

router 要知道的是「**能派哪些能力、每个能干什么**」，而不是几十份工具 schema。
插件为此维护一份**紧凑目录**，部署期静态生成并落盘，注入**决策面角色**的岗位引导。
⚠️ **注入白名单当前只含 `cordis-router` 一个角色**（`role-briefs.mjs` 的 `DECISION_BRIEFS`
白名单）；其余派工面本版未纳入 ⇒ 别的编排角色目前**拿不到**这份目录。

真实落盘样例（生产实测，2026-11-16）：

```
# 能力标签目录(部署期静态; 组装面 = 标签并集, 单件可作补丁)
# 组装 = dispatch_composed(capabilities=[标签]); 标签即整面, 不用写工具名
- literature(26 件): 多库学术检索(8库+3引擎)+引文核验+文献抽取
- reader(10 件): 网页与文件轻读(只读面, 不写不派)
- reader-lead(11 件): 轻读面 + 可再派一级(带队长)
- literature-lead(27 件): 文献检索面 + 可再派一级(带队长)
- ocr(11 件): 图片/PDF 版面与文字提取
- orchestrator(6 件): 纯编排: 只有派单权与任务清单
- bio(10 件): 生信命令行作业(shell + 文件读写)
- web-report(11 件): 检索 + 读写成稿(网页报告)
- router(18 件): 路由者: 派单 + 沟通 + 调度(不含执行面)
```

★ **实测收益**（2026-11-15，真实会话 request/header 拆包）：
主会话 `cordis-deep` 98 件 = desc 40,811B + param 47,136B = **87,947B**；
`cordis-router` 面 19 件 = 21,029B，**且只知道 19 个工具名**（不知道那些工具能干什么）；
本目录覆盖 **43 件**工具的语义 = **753B**（生产落盘实测值：头部 2 行 171B + 正文 9 行 572B + 换行 10B）。

★ **为什么是部署期静态**：实测 cacheR 中位 86.3%，会话内动态换面盈亏平衡 ≈16 轮/会话，
而实测每会话目录重发中位数仅 4 次 ⇒ 会话内换面**必然亏本**。

★ **为什么不剥参数**：宿主 `projectToolSchema()` 与 `validateArgs()` 读的是**同一个**
`definition.parameters` ⇒ 剥了参数模型照样调，执行时校验必挂 ⇒ 那是制造错调，不是省 token。
⇒ 正确形态 = 决策面**不带工具 schema、改带一份紧凑目录**；真正要执行的工具由执行面带完整 schema。

### 3.5 `workflow` —— 批量子代理编排

JS 脚本编排 subagent 群（`agent` / `pipeline` / `parallel` 钩子）。适合一次性大规模 fan-out
（多文件审计 / 迁移 / 对抗验证）；单两次派发用 `subagent` 更省。

---

## 4. 治理：新用户拿到的工具面

### 4.1 底线清单（`baseline_deny`）

> ★ **两套数，别混**：**内建底线条 40 件**（`host.v2.mjs` 的 `DEFAULT_BASELINE` =
> 随包 `config.default.json`，**新用户缺省态**，两处逐件同序相同）；
> **生产运行位**则由你自己的 `config.json` 决定（本机实测 **70 件**）——
> 治理面以**运行位**为权威，下面这张表是**内建底线条**的构成。

子代理（depth > 0）**默认没有**下面这些，**无论用哪个 preset**：

| 组 | 件数 | 内容与理由 |
|---|---|---|
| 文生图/画布 | 6 | `generate_image` / `generate_images` / `edit_image` / `find_inspiration` / `canvas_state` / `view_canvas` |
| MoA | 9 | 对抗审查由主会话决策发起，不在树内自发（防编排风暴 + 成本失控） |
| 宿主管家 | 5 | `dsh_web_restart` / `plugin_manager` / `provenance_audit` / `video_cap_probe` / `simulate_prune`（宿主生命周期权力不下放） |
| goal/schedule | 8 | 长任务与定时是主会话职权 |
| 派单系 | 3 | `illus_subagent` / `preset_dispatch` / `preset_send_message`（内置底线的理由是「平级外送是主会话职权」；★ 该理由已被用户 2026-11-15 裁定推翻 ——「子代理各级平级发送是可以接受的」⇒ 子代理要平级外送时，走 **preset 路线**的 `preset_allow` 豁免集获得，不靠组装标签） |
| 编排 | 1 | `workflow`（多代理编排风暴入口） |
| MCP 维护类 | 8 | research-tools / zotero 的维护诊断件（检索类全保留） |

**新用户 config 缺省** = `config.default.json`，其 `baseline_deny` 与内置表**逐件同序相同**
（由 `scripts/probe-baseline-sync.mjs` 守卫，防止蓝本漂移）。

### 4.2 主会话 vs 子代理

| | 主会话（depth 0） | 子代理（depth > 0） |
|---|---|---|
| 底线清单 | **不适用** | **适用**（新用户缺省态 = 内建蓝本 40 件全裁；你自己的运行位多少件，以 `config.json` 为准） |
| 裁剪依据 | `main_deny` / `main_preset_extra_deny` / preset 正面清单 | `baseline_deny` − preset 豁免集 + preset 加裁 |
| 缺工具时 | —— | 调 `explain_gate` 看**缺了什么、被哪条规则裁的**（只读，不改配置） |

★ **新用户的 config 缺省全是空的**：`preset_allow: {}` / `preset_extra_deny: {}` / `preset_deny: []`
/ 无 `capabilities` 键（走内置表）⇒ 装完即上面那张表，一件不多一件不少。

### 4.3 工具说明机制（自动）

- 每个工具**被发现时自动标注**（台账 `annotations.json`）
- 质量闸三条：非空 / ≥12 字节 / **相对工具名有信息增益**（说明里含有工具名之外的实词）
- 不达闸的进「待标注」队列（面板「📝 工具说明」页签可就地补写）
- 模型侧按需查：`describe_tools`（**不进系统提示** ⇒ 零常驻成本 + 完整信息可得）

---

## 5. 三条已定的边界（别踩）

### 5.1 组装面不能装底线件

`dispatch_composed` 有一道**底线闸**：标签里含任何 `baseline_deny` 件 ⇒ **整批派发报错点名**，
不静默剔除。唯一的例外是 `dispatch_composed` 自身（级联机制需要它）。

⇒ **想给子代理某件底线工具，用 `subagent` + 对应 preset，不要用组装标签**。

### 5.2 兄弟会话之间**没有**直连通道

`send_message` 只允许两条路径：**你的直接子代** / **你的直接父代**。
兄弟要通信只能 A → Router → B **两跳**，每跳内容都进 Router 的上下文。

（这条是当前架构的已知限制，未来处理项见 `roadmap.md`。）

### 5.3 子代不该直接问用户

新用户的 `cordis-sub` 压根不注册 `ask_user_question` ⇒ 子代缺信息时**回报父级**，
由父级决定问用户还是自己判断。这条在**开箱状态就成立**。

---

## 6. 常用动作速查

| 我想… | 怎么做 |
|---|---|
| 干一件自己就能干的事 | 主会话直接干（`cordis-deep` 面） |
| 派一个能读文件/跑命令的 Worker | `subagent`（继承 cordis-sub 面） |
| 派一个**只要轻读**的 Worker（省面税） | `dispatch_composed(capabilities: ["reader"])` |
| 派一个只做文献检索的 Worker | `dispatch_composed(capabilities: ["literature"])` |
| 让 Worker 还能再往下派 | `dispatch_composed(capabilities: ["reader-lead"])` |
| 一次并行开 5 个 Worker | `dispatch_composed(tasks: [...])` 或 `workflow` |
| 查某件工具到底能干什么 | `describe_tools(names: ["..."])` |
| 子代理说「没有某工具」 | 让它调 `explain_gate` 看归因（缺了要归因，主会话才定位得到） |
| 看裁剪台账 | 面板「📜 裁剪台账」页签 |
| 改治理配置 | 面板「🚦 闸门与发现」/「🧪 能力标签」页签；**保存即生效**（仅之后创建的会话） |

---

## 7. 一页速查图

```
新用户 profile
├── 主会话 cordis-router（零执行）
│   ├── 派 subagent        → cordis-sub（全工具）      ┐
│   ├── 派 dispatch_composed → dtg-shell（按标签组装）  ├─ 底线清单全裁
│   └── 派 workflow        → 一群 Worker               ┘
│
├── 能力标签（内置 5 个）: literature / reader / reader-lead / literature-lead / ocr
│   每个都含 describe_tools ⇒ Worker 能自查工具用途
│   每个都含 explain_gate ⇒ Worker 能自查缺了什么、被谁裁的
│   决策面另有「能力标签目录」(748B) ⇒ router 知道能派什么，不必背工具 schema
│
├── 工具说明台账: annotations.json（自动标注 + 质量闸 + 面板补写）
│
└── 治理: baseline_deny 底线（内建蓝本 40 件 / 运行位以 config 为准）/ preset 豁免集 / 主会话正面清单
    缺工具 → explain_gate（只读诊断，给归因）
```

---

## 8. 复核方式

本文事实可逐条复核：

| 事实 | 复核位置 |
|---|---|
| **发布态 3 个** preset（cordis-router / cordis-sub / dtg-shell）与其工具行 | 随包 `cordis.patch.yml`（仓库态是 4 段，core3 裁掉 `sci-lite`；`release-out/cordis.patch.yml` 为发布态真值） |
| 内建蓝本 40 件与其分组 | 随包 `config.default.json` + `host.v2.mjs` 的 `DEFAULT_BASELINE`（同源同值）；运行位实际件数以 `config.json` 为准 |
| 标签表 5 个与件数 | `host.v2.mjs` 的 `DEFAULT_CAPABILITIES` |
| 能力标签目录的形态与体积 | `host.v2.mjs` 的 `buildCapabilityCatalog` / `CAPABILITY_PURPOSE`；落盘文件在 profile 目录 `capability-catalog.txt` |
| 岗位引导原文 | 随包 `agents-briefs/*.md`（`_common.md` + 各角色段） |
| 组装底线闸 | `host.v2.mjs` 的 `baseSet` / `dispatch_composed` 入口段 |
| 兄弟无直连 | 宿主 `dsh-subagent/lib/index.js` 的 `sendMessage` 邻接校验 |

**守门探针**：`scripts/probe-baseline-sync.mjs`（蓝本↔内置表同源同值）、
`scripts/probe-baseline-gate.mjs`（底线闸）、`scripts/probe-annotations.mjs`（说明机制）、
`scripts/probe-capability-catalog.mjs`（能力标签目录）。
