# Changelog — dsh-depth-tool-gate

> 最新版本在前。版本号单一权威源 = `package.json`。条目中的 commit hash 是可校验的锚点。

## v0.15.1 (2026-11-14) —— 补发批(0.15.0 已发布后才补齐的三项入包内容)

> 可校验锚: 源仓 commit `39c8789`(本批主体) / `8b2b8bb`(canary 生产位形态判别)
> / `ac0ae1d`(账实不符修正 + 基线劫持路径封堵); 发布仓 tag `v0.15.1`。
> ★ 锚只列**已固化**的 commit(不列本文件自身的提交, 否则自引用即过时)。

**为什么单独发补丁版而不是重发 0.15.0**: npm 不允许同版本号重发。0.15.0 发布后
又补了三项**会进包**的内容, 故只能升号。

### 本批补齐的三项(0.15.0 的 npm 包里缺这三项)

| 项 | 内容 | 0.15.0 包里有? |
|---|---|---|
| ① `explain_gate` 归因补 `preset` 态 | lock 的 state 有四态(seen/pending/forced/preset); preset 态工具若不可见, 原链会落到 `dtg-unknown`(= 报告缺失) ⇒ 补一档「preset 自带工具(<preset>)(不在本会话的挂载范围)」。★ 放**最后**: preset 态是「归属」而非「裁剪原因」, 不能盖住更具体的归因 | ❌ 缺 |
| ② `config.default.json` 补 `preset_rules` 样板 | 三通道(deny / exempt / allow)+ 非法值 fail-loud 说明; 新用户照着填 | ❌ 缺 |
| ③ 全链流程图 + canary 文档两节 | `docs/gate-flow-v015.drawio` + `.png`(三层来源→记账层→执法层→可见面→explain_gate→面板, 逻辑全部从源码核对); canary 文档补「explain_gate 是什么」「挪出 baseline_deny 的效果」两节 ⇒ 补齐域会话无法自查的能力缺口 | ❌ 缺(4 件) |

⇒ 导出物 31 件 → **33 件**; `host.v2.mjs` / `config.default.json` / `docs/canary-v015.md` 三个文件内容与 0.15.0 包不同。

### 顺带修正的既有缺陷

- `scripts/canary-v015.mjs` 的版本断言硬编码 `0.15.0` ⇒ 升版后必然假红 ⇒ 改为读源仓 `package.json` 的版本号做比对;
- 同脚本 C1 的「进程启动时间晚于改动落盘」阈值硬编码 `2026-11-14T02:40:00Z` ⇒ 后续任何改动都会让该判据**假绿**
  ⇒ 改为比对**源码文件 mtime**(改动落盘时间)与进程启动时间, 阈值不再写死;
- 同脚本 C1 的「生产包版本 == 源仓版本」断言在**开发形态**(生产位是源仓 symlink)下**恒真**
  ⇒ 零判别力(读的是同一个 `package.json`)⇒ 按 `lstat` 判别安装形态, 开发形态下
  标为「无判别力」不充绿, 真判据交给 mtime 那条; 发布形态(真实目录)下版本断言照常生效;
- 同脚本 C1 的详情文案写死「⇒ 早于落盘 ⇒ 仍是旧码」, 条件成立(PASS)时仍显示
  ⇒ 文案与结论相反 ⇒ 改为随判定翻转。

### ★ 封堵一条迁移闸门假绿路径(实测发现的真缺陷)

**路径**: `scripts/probe-golden-baseline.mjs` 无位置参数时默认写
`scripts/golden/<时间戳>/` ⇒ 任何「跑一遍全量探针」的批量回归都会在 golden
目录**遗留垃圾目录**(实测: 批量循环跑一次即多出一个时间戳目录)
⇒ 而 canary C4 取基线的逻辑是 `readdirSync(goldenDir).sort()` 取**末位**目录
⇒ 垃圾目录时间戳只要更新就会被当成「迁移前基线」
⇒ C4/C5 变成「拿自己刚采的快照和自己比」= 恒等于无 ⇒ **迁移闸门假绿**。

**双重修法**:

- **探针侧**: 无位置参数时**只读不落盘**(写出必须显式指定 outDir, 由人决定
  目录名与位置)。★ 判据用 `outIdx < 0` 而非 `!outIdx` —— `findIndex` 未命中
  是 `-1`, `!(-1) === false` ⇒ 首版守卫形同虚设(实测无参数照旧落盘)。
- **canary 侧**: 基线选取改双保险 —— ① 基线必须带显式 role 标记(golden.json 的
  `role` 含 `migration-gate-baseline`), 采集产物一律不算基线; ② 多份合格时取
  配置指纹与当前一致者, 仍多份则取 `collectedAt` **最早**者(= 真正的迁移前)。

**效果实测**: 旧逻辑一直拿覆盖面窄的 3 组快照当基线; 新逻辑正确选中 8 组迁移
闸门基准 ⇒ C4 覆盖面 3 组 → 8 组, 且如实显示 `illus-deep 60→158` /
`word-deep 174→176` 两组**变大**(P0 修域工具误杀的效果), 缩面 0 组。
**变异验证**: 造一个时间戳最新(`9999-…`)的无 role 垃圾目录 ⇒ canary 仍选中
正确基准 ⇒ 劫持被挡住(旧逻辑此时会选中垃圾目录)。

### 回归

28 套探针全绿零异常(打包时点); 发布链 A6/A16/A17/A18 全绿。

★ 第 29 套 `scripts/probe-explain-preset-attr.mjs`(explain_gate 的 preset 态归因
可达性 + 优先级)是在**本包定稿之后**新增的, 不在本包内 —— 它坐实了 ① 的归因
档**可达且优先级正确**(非死代码), 变异通道证明该断言有判别力。

## v0.15.0 (2026-11-14) —— preset 工具面配方批(域工具误杀根治 + 每 preset 一份配置)

用户诉求(跨三轮对话收敛): **"是不是应该基于每个 preset, 有一个专有工具过滤的配置?
就每个 preset 可以彻底避免筛选的白名单?"**

调研中挖出**比原诉求更严重的生产故障**, 故本批以「根治故障」为主、配方为辅。

### 故障 A: 域 preset 自带工具被治理闸门整批误杀(实测坐实)

`preset_dispatch(preset=illus-deep)` 实测会话**仅 60 件工具**, 67 件 `mcp__illustrator__*` +
29 件 `mcp__illustrator-vec__*` **一件不可见** —— 而该 preset 的岗位引导明确承诺
「Illustrator 绘图域, 67 绘图工具」。台账逐字坐实:

```json
{"preset":"illus-deep","depth":1,"denied":154,
 "pendingDenied":["mcp__illustrator-vec__…","mcp__illustrator__…"],"visibleAfter":60}
```

**根因链**(每环有源码/实测支撑):

1. preset 行注册的工具落在 **preset 层 = agent 的父层**(非 own 层)
   ⇒ 工具名进 `view(agent).restrictableNames`(`dsh-tools/lib/index.js:489-491`);
2. `syncLock` 把 known 里所有没见过的新名一律建 `pending`(`host.v2.mjs:356-374`);
3. `pendingDeny` 无差别并入 deny 集(`host.v2.mjs:376-388`)
   ⇒ 域 preset 被自己的闸门杀了自己的工具。

**生产 lock 409 件逐件量化**: pending 280 / ∩`baseline_deny` **0** / 其中域工具 **278**
(illustrator 96 / word 120 / excel 59 / ppt 3) / 全局层 ∩ preset 层 **0**
⇒ **278 件误杀 100% 由 autoDenyNew 自动闸门造成, 用户一条配置都没写**。

**修法**(来源感知 pending):

- 新名按**来源**分类: 全局层 → `pending`(闸门拦) / preset 层 → `preset`(只记账, 不进 deny 集);
- **存量 pending 重判**: 已存在的 pending 若不属全局层 ⇒ 改判 `preset`
  (★ 关键: 改入参**不会**让已存在的 280 个 pending 自动消失, 重判是修复闭环的必要环节);
- 重判**只降级不反向**, 且只动 `pending` 不动 `seen`/`forced`;
- preset 层新名仍写进 lock(标 `state:"preset"`)⇒ 不产生审计盲区。

### 故障 B: 同构的域 preset, 3 个完好 1 个全灭 ⇒ 机制缺陷非配置疏漏

| preset | 声明应有 | 实测面 | 差集 |
|---|---|---|---|
| illus-deep | 156 | **60** | −96(域工具全灭) |
| word-deep | 174 | 174 | 0 |
| excel-deep | 113 | 113 | 0 |
| ppt-deep | 57 | 57 | 0 |

word/excel/ppt 侥幸完好是因为 `preset_allow` 抄全了各自 MCP 的全部工具名
(word 120 / excel 59 / ppt 3)⇒ **现状要求用户逐件抄写每个域 preset 的全部 MCP 工具名**,
MCP server 一升级就得重抄 —— 不可持续的配置形态。

### 本批交付

**① 来源归属表**(`profile/origin.json`)—— 每 preset 一份「它自带的工具」的真相:

- 运行时权威 = `agentPresets.composedPreset(ctx)`(官方只读入口, 沿
  `generationFor` → `scopeParentOf` 解析, `composeFrom` 继承分支也正确)
  + `view(agent).knownNames ∖ view(undefined).knownNames`(非全局层 ⇒ 必来自 preset 层);
- 静态兜底 = 从 profile patch / 包内 patch 扫 preset 块的 `serverName`
  ⇒ 覆盖**尚未 mount** 的 preset(实测 15 个 profile preset 中 8 个带 MCP server);
- 增量合并(并集去重, 不丢历史) + 每次 agent 创建时自动补全 + 损坏时重建不崩;
- ★ 不用 `view(presetScopeKey)`: `registry.generations` 是私有 Map, 无公开入口。

**② 按 MCP server 自动归类** —— 取代 `client.js` 硬编码的 7 组 40 件:

`mcp__<server>__*` 按 server 成组 / `dsh_*` 第三方插件组 / `moa_*` MoA 组 / 其余原生组
⇒ **新装 MCP server 天然有组可归, 不必改代码**(原形态: 已知 409 件里 369 件无组,
新装工具只能裸列在「未裁决」区)。硬编码表降级为**回退**(host 不可用时才用)。

**③ `preset_rules` 三通道**(用户要的「每 preset 一份专属配置」):

```jsonc
"preset_rules": { "<presetId>": { "deny": [], "exempt": ["auto"], "allow": null } }
```

- `deny` = 用户显式禁用 —— 最强, **无豁免**(`preset_allow` 的豁免权对它无效);
- `exempt` = 豁免哪些自动机制 —— 本期**只支持 `"auto"`**(豁免 autoDenyNew 自动闸门),
  **只影响 pending 通道**, 是 **per-preset** 的(豁免 A 不影响 B);
  底线闸与显式禁用**照常生效**;
- `allow` = 严格 keep-only 正面清单 —— **可选, 默认不启用**
  (★ 五路异构盲审一致: keep-only 会裁掉域 preset 自己的工具,
  生产先例 = `role-briefs` v0.7.1「allow 17 ⇒ visible 6」; 故降为可选严格模式);
- 非法配置 **fail-loud**: 读侧(该 preset 规则不生效但会话照跑)与
  写侧(拒绝整次保存、不落盘半份配置)两层口径一致 ⇒ 不出现「保存成功但运行期忽略」。

**④ `preset_allow` 双语义拆键**(裁决③):

同一张表两种强度(主会话侧 = keep-only 正面清单 / 子代侧 = baseline 豁免集)⇒
拆为 `preset_allow`(子代, 语义逐字不变) + `main_preset_allow`(主会话)。
**唯一的行为变更 = 回落读从静默改为显式告警**(台账 `allow-fallback` 事件 + 面板可见 +
可一键拆分/撤销)⇒ 未拆分的 preset 主会话面与 v0.14.5 **逐件一致**(零缩面)。

**⑤ 面板**: 逐 preset「天然完整面」(用户不写工具名)、自动归类、专属配置编辑面、
拆键按钮、`explain_gate` 补 `preset_rules.deny` 归因(原先报 `dtg-unknown` = 报告缺失)。

### 顺带修正的既有缺陷

- `renderRuledTable` 的 `shown` 原来用 `GROUPS` 而非 `tableGroups`
  ⇒ 按角色页渲染的是**全局组**而非该角色的组;
- `explain_gate` 未认 `main_preset_extra_deny` 之外的 `preset_rules.deny`(补齐);
- 探针纪律: 既有探针锚在具体变量名 `GROUPS.flatMap(groupMembers)` 上 ⇒ 重构后误报
  ⇒ 改为断**语义**而非**写法**(本批沉淀的纪律)。

### 迁移与闸门

- **零缩面保证**: 旧键全部保留读时语义; 未配 `preset_rules` 的 preset 与 v0.14.5 逐件一致;
- **golden 基线闸门**: 逐 `preset × depth` 采集运行面(visibleAfter/denied/missing),
  迁移前后逐件 diff; 差集非空(面**变小**)⇒ 回滚;
  ★ 三道可比性闸: 时间下界 / 配置指纹 / 每组 ts
  (台账是跨版本历史累积, 882/909 条产自旧配置时代, 不可直接当基线);
- 沙箱七步已过(test profile 3081: dtg 新版加载零异常、无 DEGRADED、hash 对账一致)。

### 探针

27 套探针全绿零回归; 本批新增 4 套(`probe-source-pending` 18 项 / `probe-allow-split` 18 项 /
`probe-preset-rules` 22 项 / `probe-origin-groups` 19 项 / `probe-client-groups` 14 项 /
`probe-sandbox-p0` 14 项 / `probe-golden-baseline` 闸门工具), 每条断言配变异通道
(判别力 = **自己那条**必须转红) + 阴性对照。

## v0.14.5 (2026-11-13) —— router 漏装根因修复批(自治理误杀 + 两件从未注册)

用户报的现象: **"router 角色不能很好地组装相应的工具, 总是漏装或者不装相应的工具。"**

### 症状(生产台账 5 条 depth0 router 记录恒定)

```
mode=allow  denied=19  allowed=17  missing=[ask_user_question, web_fetch]  visibleAfter=6
```

**允许了 17 件却只可见 6 件** —— 允许清单与实际可见面严重不符。

### 根因: 不是宿主 bug, 是 dtg 自己两套裁剪叠加

调查: qwen4-max-preview 子代理(只读)+ 主会话独立复核三环(file:line 级)。

**① 落点错** —— `role-briefs.mjs` 的 v0.7.1「正面清单自治理」在 **preset 注册期**执行。
`role-brief` 行挂在 preset 树内 ⇒ 其 ctx 的 scope = **preset generation key**
(`dsh-agent-preset-registry/lib/index.js:511-513` `createScope(this.owner, key)` →
`:219-236` `mountPreset` 在该 ctx 建树)。而 generation 又是 agent scope 的**父**
(`:684-686` `bindScopeParent(key, generation.key)`) ⇒ 这份 restriction 被
**所有 router 会话共享**、重启后按同逻辑重建、**恒久存在**。

**② 视角错** —— 自治理用**无参 `view()`** = 纯全局层(`dsh-tools/lib/index.js:477-488`,
scope=undefined ⇒ chainLayers 空、inherited 仅 global) ⇒ `preset_allow` 19 件里
当时只有 6 件在全局层 ⇒ generation 层被永久钉上 allow-6:
- **9 件 preset 行工具**(`subagent` / `subagent_fork` / `interrupt_agent` /
  `list_agents` / `send_message` / `list_subagent_models` / `workflow` /
  `todo_write` / `skill`)注册在 generation 层、**从不是全局工具** ⇒ 必被排除;
- **2 件 illus 全局工具**(`preset_dispatch` / `preset_send_message`)虽是全局行,
  但**晚于** router preset 激活才注册 ⇒ 执行时不在全球视图 ⇒ 也被排除。

**③ 交集放大** —— `gateMain` 的 `restrict({allow:17})` 落 agent own 层, 但可见性 =
`layers.every(layer => layer.admits(name))` **含祖先层**(`dsh-tools:492`,
chainLayers 走 scope 父子链 `dsh-scope:162-169`)
⇒ visible = 继承集 ∩ generationAllow6 ∩ agentAllow17 = **6**。

实测可见集(会话日志 `request/header.tools` 解压实证, 非推断):
`add_note, dispatch_composed, list_agent_presets, note_recent, note_search,
working_directory` —— 该会话 8 次 tool/call 全在这 6 件内, **主派单通道 `subagent`
一次都没用上**。

### 修法

**① 删掉 `role-briefs.mjs` 的自治理整段**(原 `:80-106`, 引入自 `a5d7791` v0.7.1)。

它**本就是冗余**: 建它的初衷是"手开会话 `header.agentPreset` 不回写、`gateMain`
判身份恒错"(见 `a5d7791` 提交说明)。但生产台账 **5 条 depth0 router 记录全部
`preset=cordis-router`** ⇒ `gateMain` 本就能识别手开 router 会话并施加正面清单制
⇒ 这份自治理纯属冗余且有害。删除后本插件职责 = **只注入 prompt 引导**。

★ **连带面已核实(生产台账取证)**: 挂 `role-brief` 的 preset 在**两处**声明 ——
包内 patch 的 4 个(`cordis-router` / `cordis-sub` / `dtg-shell` / `sci-lite`)与
生产 profile patch 的 14 个(`sci-*` / `illus-deep` / `word-deep` / `excel-deep` /
`ppt-deep` / `paint-deep` / `gallery-deep` / `aigen-deep` / `cordis-deep-ptc`)。
自治理按 brief 名读 `config.preset_allow[brief]`, 故只有**既挂了 role-brief 又在
`preset_allow` 有键**的会被命中 = `cordis-router` + `illus-deep` / `word-deep` /
`excel-deep` / `ppt-deep` / `aigen-deep`。

**实测五个域会话零影响**: 生产台账里这五个 preset 的记录**全部 depth=1**(子代路径,
走 `gateAgent` 的豁免制), **从无 depth=0**; 且全生产 `mode=allow` 的记录**只有 5 条,
全部是 depth0 + cordis-router** ⇒ 自治理在生产**只影响过 router 主会话**,
域会话从未被它碰过 ⇒ 删除对它们**零影响**。

★ 另: 生产 preset 声明有**两个来源**, 排查时必须同时查 ——
① profile 的 `~/.dsh/profiles/web/cordis.patch.yml`(生产 15 个 preset, **无** router);
② **包内** `node_modules/dsh-depth-tool-gate/cordis.patch.yml`(由包 `package.json`
的 `dsh.bundle.patch` 声明, 含 cordis-router 等 4 个) ⇒ 生产 node_modules 是源仓
symlink ⇒ 改源仓那份 = 改生产真正加载的那份。

**② router preset 补挂两行**: `tool-ask-user` + `tool-web`(`fetch: true` /
`search: false`)。这两件原先**根本没注册**(router 段无该行, 全局也无)
⇒ 任何层都不存在 ⇒ 不在 `restrictableNames` ⇒ 报 missing、模型调不到;
而 router brief 明确承诺要用它们(「信息不足先向用户澄清再派单」/「唯一例外
web_fetch(用户消息带链接时看一眼以判断派单)」)。
★ `preset_allow["cordis-router"]` 19 件**本来就含这两件**(当初照 brief 写的)
⇒ 补挂后名单正好对上, **无需改生产配置**。

### 服务依赖安全性(生产先例坐实)

`tool-ask-user` 的 inject = `["tools", "userQuestions"]`
(`dsh-tool-ask-user/lib/index.js:216`) ⇒ 若 `userQuestions` 服务不在该 preset 的
scope 链里, preset 挂载会因 `leakedServices` 抛错 ⇒ **生产启动失败级**风险。

实测坐实安全: 生产 profile patch 里有 **10 处 `tool-ask-user` 启用行**(sci 系列 /
word-deep / excel-deep / illus-deep 等), 那些 preset **每天成功挂载**(台账 depth0/
depth1 记录为证) ⇒ 该挂法在生产已被先例证明安全。
官方 `@deepseek-ai/dsh-web-app` 的 `presets/cordis.patch.yml:111-119` 也是**同款挂法**
(preset 顶层、delegation 组外、`tool-ask-user` 启用 + `tool-web` 带 `fetch: true`)
⇒ 本批改法与官方先例同构。
★ 本批比官方多一行 `search: false`(router brief 明确「不检索库(web_search/MCP)」)
⇒ 与 `cordis-sub` 段的 fetch/search 组合刻意不同, 已在代码注释写明。

### 判别力自证

新增 `scripts/probe-router-v145.mjs`: **13 条断言 × 2 轮 + 阴性对照 = 27 项**。
第二轮每条断言配一个**内存变异**(回退到修复前的样子)⇒ 必须转红; 第三轮阴性
对照证明按内容判定。变异全程只改内存字符串, 不落盘不碰生产。

★ 探针自身修正两处(v0.14.4 的教训延续): ①「不再读 preset_allow」这条断言改为
**只看代码不看注释**(注释必须留沿革说明, 那不是"读配置做裁剪");
②「两行在 delegation 组外」这条的变异体改为**真的把行移进组内**(原先只改 id 名
⇒ 断言仍绿 = 无判别力)。

### 未修项(如实记录)

- `ask_user_question` / `web_fetch` 修好后**主会话面**应恢复到 17+2 = 19 件,
  但**子代侧**(`cordis-sub`)不挂 `tool-ask-user`(其 `:147-149` 明确 `disabled: true`),
  故子代面不含它 —— 属**有意设计**(子代理不该向用户提问), 不是漏装。
- `preset_dispatch` / `preset_send_message` 两件 illus 全局工具**晚注册**问题:
  删自治理后它们不再被 generation allow-6 误杀, 但若 `gateMain` 执行时它们仍未
  注册, 仍会落 missing —— 需在重启后实测确认。

## v0.14.4 (2026-11-13) —— 渲染面唯一 + 子代全量可裁 + 文案诚实批

用户报的现象: **"我看到 yuanbao 有重复"** —— 面板上同一件工具出现两遍。本批修三宗缺陷
(前两宗是 v0.14.3 自己引入/遗留的), 并把 MoA 盲审指出的残留一并清掉。

### P1-1 常用件双份渲染(用户报的直接原因)

| 区块 | 来源集合 | v0.14.3 状态 |
|---|---|---|
| 「未裁决工具」 | `snap.restrictable − 已裁决` | **不减任何集合** ⇒ 常用件在此 |
| 「🟢 常用件」 | `KEEP_LIST ∩ 运行时` | 也在此 ⇒ **同一件渲染两遍** |

实测重复 **13 件**: `read/write/edit/glob/grep/web_search/web_fetch/todo_write/skill/
job_list/job_output/job_kill/mcp__yuanbao-search__SearchPro`。

**v0.14.3 撤销排除的理由是错的**: 我当时写"排除后常用件不可禁, 要留在未裁决区才能勾" ——
但**常用件区本就带两层勾选框**(v0.14.2 源码已核, checkbox 直连 draft), 排除只影响
"未裁决区"这一处**展示**, 不影响可禁性。

修法: 未裁决区排除常用件; **常用件区保留两层勾选** ⇒ 渲染面唯一 + 可禁性守恒。
★ 元教训: **「从 A 区排除」≠「从 B 区移除」** —— 先确认 B 区是否另有勾选入口。

### P1-2 子代按角色页无运行时兜底 ⇒ "所有工具都能按 preset 禁用"只落地一半

v0.14.3 只给**主会话**按角色页补了全量候选池(`mainRoleExtra`), **子代按角色页漏补**:
候选面 = 固定 7 组 ∪ 已裁决件 ⇒ **从未被禁用过**的工具(如 yuanbao)在该页
**根本不出现、无法按角色禁**。

修法: 新增「➕ 其他可按角色禁用的工具」折叠区(运行时快照全量池, 与上表去重),
勾选走**同一套** `updatePresetRules`(不另起规则)。

### P1-3 面板文案残留谎报(行为 v0.14.3 已改, 文案没改)

| 位置 | 旧文案 | 现文案 |
|---|---|---|
| `client.js` | 「保护件自动剔除」「保护件除外」 | 「核心能力照裁但会提示」 |
| `host.v2.mjs` | 日志串「保护剔除=N」 | 「核心能力照裁=N」 |
| `host.v2.mjs` | 注释「误裁核心工具会被剔除」 | 「照裁 + warn 提醒后果」 |
| `config.default.json` / 生产 config `_note` | 「保护集兜底」 | 「核心能力照裁, 只提示」 |
| `README.md` / `README.zh.md` | 「会自动从 main_deny 里剔除」「is stripped … automatically」 | 「不是裁剪闸: 照裁 + warn + 台账记 blockedProtected」 |
| `docs/agent-faq.md` | 「保护集兜底防裁瘫」 | 同上 |
| `docs/panel-guide.md` | 「主会话禁(保护件置灰)」 | 「主会话禁(核心能力也照裁, 只提示)」 |

顺带: 台账 `rec` 补 `blockedProtected` 名单字段(host 注释早就承诺"台账记计数"但字段不存在)。

### MoA 盲审指正并已修的四处

1. **`moa_` 前缀组双渲染**(v0.14.3 遗留 + v0.14.4 初版自引入): 去重集合用
   `GROUPS.flatMap(g => g.names || [])` **只收显式 names**, 而 moa 组是
   `prefix:"moa_"` ⇒ 全部 moa_ 工具同时出现在上方 moa 组与兜底区。
   修法: 去重与渲染**必须用同一取成员函数** `groupMembers(g)`(会展开 prefix)。
2. **兜底区勾选态只认 `selectedExtra`**: baseline 件的"取消禁用"写的是
   `preset_allow`(放行)而非删 extra ⇒ 显示"未勾"但实际禁用(状态反了)。
   修法: 勾选态改用 `effectiveDenySet ∪ pendingSet`(该角色**最终禁用**态)。
3. **空态文案谎报**: 排除常用件后 `discovered.length===0` 仍写"全部运行时工具均已裁决"
   —— 常用件只是移到了别的区、并未裁决。修法: 改说"未裁决区已空"并指出常用件区仍在。
4. **探针覆盖面不足**: 初版只扫 client+host, 漏掉 README/docs/config.default.json ⇒
   文档残留不在断言范围。修法: 文档文本作为**第三个断言输入**参与变异。

### 探针自身的三处缺陷(已修, 记录在案)

v0.14.4 探针初版三度假红/假绿, 均为**探针的 bug 而非代码的 bug**:

1. `run` 签名错位: H 类断言写成 `(H) => …`, 却按 `(mC, H0)` 调用 ⇒ 拿 client 源码去查
   host 内容 ⇒ 9 条"无判别力"假红 + 2 条真红被误判。
2. 变异体打空: `C.replace("...[...runtime, ...own]", "…own")` 的锚点串写错(多一个点)。
3. **文档类断言无变异通道**: 断言读盘, 变异改内存字符串 ⇒ "变异后仍绿"假阳性。
   修法: 文档文本纳入断言输入(第三个参数 D), 变异体必须改变 D。

★ 教训: **断言的每个输入都必须有对应的变异通道** —— 否则"变异后仍绿"不是结论, 是探针坏了。

另修 `probe-panel-v142.mjs` 一条**距离窗口断言**(`mainRoleExtra` 后 500 字符窗口):
新注释一长就把串顶出窗口 ⇒ 语义未变却报红。改为**截取函数体再判定**(免疫注释长度漂移)。

### 判别力自证

新增 `scripts/probe-panel-v144.mjs`: **22 条断言 × 2 轮 + 阴性对照 = 45 项**。
- 第一轮: 对真实源码 ⇒ 全绿;
- 第二轮: 每条断言配一个**内存变异**(回退到修复前的样子)⇒ 必须转红;
- 第三轮: 阴性对照(无关篡改)⇒ 断言集仍全绿(证明按内容判定, 非按文本存在性)。

变异全程只改内存字符串, **不落盘、不碰生产** ⇒ 零污染(沿革: v0.14.1 前的探针曾用
`withMutation` 改真实源文件, 留下过污染 —— 教训见 release-guide.md「探针隔离纪律」)。

契约漂移处理: `probe-panel-v142.mjs` / `probe-panel-v143.mjs` 各有断言被本批**推翻**
(未裁决区契约两度演化), 已按纪律**更新断言并注明沿革**(不是删测试)。

回归: 22 套探针 **0 fail**; A18 发布态冒烟 21/21; 生产台账 `peer-missing` 仍 0。

## v0.14.3 (2026-11-12) —— 「所有工具都可按 preset 禁用」原则落地

用户裁定(原话): **"我认为所有的工具都可以在 preset 中禁用。就完全禁用的就是只是一个
chatbot, 这个没有什么问题。"** —— 工具面治理不该替用户做"手滑保护"决定, 只该如实执行
并告知后果。本批把这条原则从口头期望变成**可执行断言**。

### 根因: 现状有四处违背该原则(全部实测确认)

| # | 违背 | 实测证据 |
|---|---|---|
| ① | `PROTECTED_MAIN` **硬剔除** ⇒ 主会话侧 `main_deny` / `main_preset_extra_deny` 里的保护件被**悄悄丢弃** | 构造实验: 同一件 `read`, 负面路径(A/B)读出来仍可见, 正面路径(C 允许清单)读出来消失 ⇒ **同一能力两种结果** |
| ② | 前端两处 `disabled: prot` 把保护件勾选框**置灰** | 源码 `client.js` 两处; 用户看到的是"这个不能点"而非"点了会怎样" |
| ③ | pending 快捷裁决**直接 return**, 拦下保护件的主会话禁操作 | `mainRulePending` 首行 `if (protMain(n)) { ...; return; }` |
| ④ | v0.14.2 我自己引入: 常用件被**排除**出未裁决区 ⇒ 反而使它们**不可禁** | `discovered = ... && !KEEP_NAMES.has(n)`; 且角色页候选池只取"已在 deny 名单里的件" ⇒ 从未禁过的 yuanbao 在任何角色页都不出现 |

### 修法

- **host**: `PROTECTED_MAIN` 从"硬剔除"降级为**警示但不阻断** —— 保护件**照裁**, 但
  `warn` + 台账 `blockedProtected` 计数, 明确告知"这是主会话核心能力, 会话可能瘫"。
  该集合自此只作**警示白名单**(前端提示文案), 不再是裁剪闸。
- **client**: 两处置灰移除(勾选框始终可点, tooltip 如实写"会照裁, 请确认");
  `mainRulePending` 不再拦截, 只提示; 「保留清单」改名「常用件」, 措辞改为
  "**没有任何工具是受保护的**"。
- **角色页候选池** = **运行时全量可裁工具**(`snap.restrictable`) ∪ 该角色已有条目 ∪
  `baseline_deny` ∪ `main_deny`, 减去固定分组 ⇒ 从未被禁过的工具(yuanbao 等)**也在页里,
  可勾**。
- **未裁决区** = 运行时工具 − deny 名单, **不减任何其他集合** ⇒ 常用件仍在可裁决面里。

### 顺带纠正 v0.14.2 的两处误判

v0.14.2 我把 yuanbao 列入"保留清单"并从未裁决区排除, 理由是"常驻第一页像噪音"。
按本裁定那反而**堵死了禁它的路** ⇒ 已反转: 常用件表只提供**用途说明**, 不含任何强制力。

### 判别力自证

新增 `scripts/probe-panel-v143.mjs`(17 项可证伪判据)。变异实测: 恢复 host 硬剔除 /
把角色页候选池退回"只在 deny 名单里" ⇒ 对应断言**均报红**; 还原 ⇒ 全绿。

契约漂移处理: `probe-panel-v142.mjs` 有 2 条断言被本裁定**推翻**(未裁决区排除 /
旧措辞), 已按纪律更新断言并注明沿革(不是删测试)。

回归: 18 套探针 314 项 0 fail; 全程台账 +0 行; verify-track 10/10。

## v0.14.2 (2026-11-12) —— 面板透明度批(主会话按角色页兜底 + 归因补齐)

用户报的现象: "手动选择后, 只在子代理页看到(其他额外禁用34中), 主会话按角色禁用
与能力标签两页都没有"。根因**不是配置没生效**, 而是面板三处不透明。

### ① 主会话按角色页缺「兜底分组」(UI 结构缺陷)

子代理页有 `extraOnly` 兜底(`client.js:376`), 主会话页只渲染 `GROUPS` ⇒ 任何
**不在固定分组里**的工具(第三方插件的 `dsh_im_*` 等)在主会话页**根本看不到、
无法勾选** —— 用户以为"没生效/没有选项", 实际是 UI 缺兜底(子代理侧能看到正是
因为有兜底)。

修法: 主会话页同构补兜底; 候选池 = 该角色已有条目 ∪ `baseline_deny` ∪ `main_deny`
减去固定分组 ⇒ 既看得见自己叠了什么, 也能把已在子代理侧裁决过的件加禁到主会话。

### ② explain_gate 不读 main_preset_extra_deny ⇒ 主会话按角色禁用不可解释

归因链只有 `main_deny` / `baseline_deny` / `preset_extra_deny` / `preset_allow` / lock,
**没有 `main_preset_extra_deny`** ⇒ depth0 主会话里被该表裁掉的工具一律报
`dtg-unknown` ⇒ "被禁了但说不出为什么"(报告缺失)。

修法: 补该分支, 与 host 实际裁剪路径(`host.v2.mjs:566` `deny=[...main_deny,...extraDeny]`)
**同源同序**(main_deny 先判, 再判本表)。

### ③ 能力标签页与 deny 体系完全脱节

此前只有一坨 textarea, 无任何归属信息 ⇒ 看不到"这件在标签面里但子代理侧被
baseline 禁了"这类冲突, 也看不到"域会话专属、运行时不可见"(184 件 word/excel/ppt
MCP 工具只挂域会话 ⇒ 主会话侧恒不可见 ⇒ 属冗余无害, 但此前无从得知)。

修法: 逐件标出 `baseline_deny` / 待裁决 / 运行时不可见 / 可见。

### ④ 保留清单从自由文本改为结构化, 并**如实化**

原 `KEEP` 是一长串人读文本, 只在页脚当说明用, 不可机器判定、无法逐件解释; 且它
**谎报** —— "保留不动(面板仅展示, 不可勾选 deny)"与实情不符: host 侧**没有**任何
全局强制保留机制(实测 grep: 只有 client 的这段字符串)⇒ 写进 `baseline_deny`
照样会被裁。

修法: ① 结构化 `KEEP_LIST`(逐件带理由)② 独立成区, 带两层勾选(仍可禁, 不隐藏)
③ 未裁决区排除保留件(否则 yuanbao 之类常驻第一页, 位置本身在暗示"等你决策"⇒ 噪音)
④ 按**运行时 restrictable 过滤**(别的 profile 没装的 MCP 工具不显示; snap 未就绪则
整区不显示, 宁可缺一段也不谎报)⑤ 措辞如实。

用户裁定: yuanbao 视为"通用可用, 类似 read" ⇒ 已入保留清单。

### ⑤ originOf 对未知来源不再只写"未标注"

`dsh_*` 前缀 ⇒ 第三方插件; 命中保留清单 ⇒ 官方保留+理由; 其余 ⇒ 来源未知 +
可执行的下一步(去 ORIGIN 表登记), 不再把用户引到一份可能没写的文档。另补 ORIGIN
表: `dsh_im_*` 三件标注来源(`@xmanrui/dsh-im`)与语义。

### 判别力自证

新增 `scripts/probe-panel-v142.mjs`(19 项, 每项可证伪判据)。变异实测: 回退
①extra 兜底 / ②归因分支 / ④运行时过滤 ⇒ 对应断言**均报红**; 还原 ⇒ 全绿。

回归: 17 套探针 297 项 0 fail; 全程台账 +0 行。

部署: `client.js` 走 `?rev=` 资源版本 ⇒ 浏览器刷新即生效; `host.v2.mjs` 是已 import
的模块实例 ⇒ ② 的 explain_gate 归因需**重启**才生效。

## v0.14.1 (2026-11-12) —— 发布链探针隔离批(测试不得污染生产观测数据)

这一批修的是**闸门自己**的缺陷: A18 冒烟闸与 A17 变异探针会往**生产台账**和
**发布导出物**里写东西。v0.14.0 的运行时修复全部保留, 运行时行为零变化。

### 缺陷① · A18 冒烟闸把假"致命"事件写进生产台账

**现象**: 跑一次 `probe-a18-mutation` ⇒ 生产台账 `audit.jsonl` 多 2 行
`ev:peer-missing, severity:fatal`; 跑一次 `probe-a17-comment-strip` ⇒ 多 3 行。
累计到 43 条(2026-11-11 25 条 + 2026-11-12 18 条), 而**生产运行侧真实为 0 条**
(`web-run.log` 全程零 `peer-missing` / 零"宿主 peer 未就绪")。

**根因**: `host.v2.mjs` 的 `const DSH_HOME = process.env.DSH_HOME ?? …` 是
**模块加载期**求值的常量, 而台账路径由它派生。A18 会真的 `apply()` 插件,
降级路径**故意**产生 `peer-missing` 事件(降级态必须可见) ⇒ 这些事件落到了
生产台账。观测数据被测试污染, 且"致命"级假事件会淹没真实事件。

**修法**: `publish-smoke.mjs` 在**导入插件之前**把 `DSH_HOME` 指向一次性临时根
(`mkdtemp`), 退出即删。顺序是硬要求 —— 晚于 import 改 env 无效。

**判别力自证**: 冒烟闸末尾加阴性对照"生产台账字节数未变"; 探针侧再加一条独立
复核(双保险)。变异自检实测: 把隔离回退(注释掉 env 覆盖) ⇒ 两条断言**同时报红**
且台账 +2 行 ⇒ 断言有判别力, 不是恒绿的装饰。

### 缺陷② · A17 变异探针把变异体写进发布导出物

**现象**: `release-out/host.v2.mjs:186` 多出一行
`const AUDIT_DIR2 = join(DSH_HOME, "logs", "depth-tool-gate", "spill");`(源仓 0 处)。
探针的 `withMutation` 只还原**源**文件, 还原不了导出物 ⇒ 每跑一次探针就脏一次。

**根因**: 本探针跑的是**真实** `release-export.mjs`, 默认 `--out` 就是 `release-out/`。
探针断言的是"退出码 + A17 报文", 并不依赖导出物落点。

**修法**: `--out` 指向 `mkdtemp` 临时目录(导出器守卫要求 `--out` 位于开发仓内
⇒ 临时目录建在 ROOT 下, 跑完即删)。判别力自证: 探针末尾断言"生产导出物未被碰过"
(逐字节比对), 并断言临时目录已清理。

### 缺陷③ · 生产台账已被污染的 43 条假事件(已清理 + 隔离留档)

**取证**: 43 条**全部**带 `锚点不存在` 指纹(探针假锚点的独家特征; 生产真实降级时
`profileContext.installAnchor` 是存在的)。`web-run.log` 零真实降级, 交叉印证。

**处置**: 逐行过滤(双条件: `ev=="peer-missing"` **且** 含 `锚点不存在` 指纹),
原子写(临时文件 + rename)。守恒校验: 740 条真实裁剪记录**逐条未变**。
43 条原文留档于 `~/.dsh/logs/depth-tool-gate/quarantine-probe-events-20261112.jsonl`
(不在 `archive/` 且不以 `audit-` 开头 ⇒ 面板读不到, 不污染观测视图)。

### 回归结果

16 套探针 **278 项 0 fail**; 全程台账 **+0 行**、导出物**字节不变**;
`verify-track` 10/10 全绿。运行时零变化(本批只动 scripts 与 .gitignore)。

## v0.14.0 (2026-11-12) —— 发布态可加载性根治 + 静默失败族清理批

这一批的主线是**"为什么这个插件总有缺陷"**的根因清理, 不是单点修 bug。
所有方案都经过 MoA 异构三路盲审 + 独立复核实测; 被盲审推翻的初版方案记在末尾
「否决项」—— 留着它们是因为"当初为什么那样想"比"最终结论"更有复用价值。

### P0 · npm 标准安装路径下插件加载失败(发布阻断级)

**缺陷**: 照 README 第一条命令 `npm i dsh-depth-tool-gate` 装上后, **整个插件加载
失败**(`ERR_MODULE_NOT_FOUND: '@deepseek-ai/dsh-typert-protocol'`), 整个 profile 受累。

**根因**(实测链闭合, 非推断): `host.v2.mjs` 用**静态裸名 import** 两个宿主包。
Node ESM 静态 import 的解析锚点是**语句所在文件自身位置**, 不是 loader 的 baseUrl ⇒
发布态装到 `~/.dsh/profiles/web/node_modules/` 时上溯链里没有宿主包 ⇒ 加载期失败。
本机永远发现不了: 开发态源仓自带 `node_modules/@deepseek-ai/` junction ⇒ 必然能解析。
**"开发态能跑 ⇒ 发布态也能跑"这个推断不成立。**

**修法**: 改用 `peer-resolver.mjs` 运行时解析(`createRequire` + 锚点链):
`profileContext.installAnchor`(宿主 DSH 本体 package.json, 权威) → 插件自身位置 →
`process.execPath` 上溯。解析到的与宿主 `dsh-tools` 侧是**同一物理文件** ⇒
`require(esm)` 与宿主 ESM import 共享同一模块实例 ⇒ `dsh-scope` 的
`kScope`(Symbol("dsh.scope"), **非注册 Symbol**)单例 ⇒ 不产生双实例。

**否决项(重要)**: 曾考虑把 peer 改成普通 dependencies(自带副本) —— **实测否决**:
双实例 ⇒ kScope 不同 ⇒ 宿主 `tools.restrict()` 抛 `requires a scoped context` ⇒
把"加载失败"升级成"裁剪静默失效"(fail-open), 比现状更糟。故必须复用宿主那一份。

**实例同一性校验(行为化, 非 typeof 形状检查)**: 形状检查 100% 免疫 ——
若锚点命中另一份 dsh-scope(自带副本 / npm 自动装 peerDependencies / hoisting),
形状照样对但 kScope 不同 ⇒ 裁剪静默失效。改用**与宿主参照实例比对函数引用**,
并在无宿主参照时明确判"未验证"(不假装通过)。

**降级姿态**(盲审三路一致推翻初版): 初版是 `return { skipped: "peer-missing" }`
= **fail-open** —— agent 拿到完整工具面而治理看起来正常, 与本插件自己批判过的
"静默失败"根因自相矛盾。改为:
- 裁剪 **fail-closed**(返回显式 error 而非 skipped);
- **不阻断宿主启动**(实测宿主 `installFailLoud`: 插件树加载失败会杀死整个 profile,
  插件没有否决宿主的资格);
- **不卸面板**(面板是唯一能看见"治理没生效"的通道, 卸掉它 = 自断观测通路);
  peer 缺失时改用兜底基类, 面板仍能打开并显示 `degraded` + 原因;
- 降级事实走**不依赖 peer / profileContext 的通道**(台账 + `DEGRADED` marker 文件)。

### P1 · 工具出口 lossless 净化(从"修一个"到"结构上不可能漏")

v0.13.3 只给 `dispatch_composed` 一个工具加了出口净化, 另三个
(`explain_gate` / `list_agent_presets` / `create_goal`)仍是裸返回 ⇒ 未来新增字段
会重演同一缺陷。改为**统一注册入口** `registerTool()`: 出口自动净化,
以后新增工具走它就不可能漏。

**toLossless 的静默丢数据修**(盲审 + 独立复核指出的缺陷): 旧版对非普通原型对象
(Date/Map/Error/class 实例)**整个键省略** ⇒ `toLossless({ error: new Error("boom") })`
⇒ `{}` ⇒ **一条失败被渲染成"成功且无错误"**。改为**显式映射**:
Error → `{__lossless:"Error", name, message, stack?}`; Date → `{__lossless:"Date", iso}`;
Map/Set/RegExp 同理; 其它对象 → `{__lossless:"<构造名>"}` + 尽力枚举自有属性;
深度超限 → `{__lossless:"DepthExceeded"}`。值总在, 且带标记, 调用方与面板都能看出。

### P2 · 台账归档(追加 + 归档, 归档不删历史)

`audit.jsonl` 此前只追加无轮转(现网 870KB)。改为: 超 8MB 即轮转为
`archive/audit-<ts>.jsonl`(**改名, 历史整份保留**), 面板 `recent()` 跨档读取
(当前档 + 归档档, 按时间倒序), 轮转检查用写计数节流(每 64 次写查一次),
启动时也检查一次。

两处实测缺陷已修:
- **档名碰撞**: 毫秒时间戳同毫秒两次轮转 ⇒ 同名 ⇒ `renameSync` **覆盖** ⇒ 静默丢
  整档历史(直接违背"历史一条不丢")。改为目标已存在时**绝不覆盖**, 追加序号。
- **注释说谎**: 旧实现注释写"尾读(只取末尾若干行)"实际是 `readFileSync` 整个文件 ⇒
  24 档×5MB 时 limit=30 仍同步读 120MB。改为**真尾读**(fd 块回退, 实测 18.2MB
  文件读 30 条耗时 0ms)。注释即契约: 说尾读就必须尾读。

诚实口径: 常规轮转一条不丢; 只有长期运行导致归档档数超上限(24)时, 最老的档会被
清理, 且**清理动作本身进台账可见**。

### 机制防线 · A18 发布态同构冒烟闸

A1–A17 断言链**全部是文本扫描**, 对"导出物装上即崩"这一类缺陷**结构性失明**。
A18 把 staging 产物装进**没有宿主包的干净目录**, 用**宿主真包 @deepseek-ai/cordis
的 Context** 真挂载插件, 断言: 入口可 import / 四个工具真注册 / **网关真挂上**
(半挂载不再蒙混过关) / apply 内部无 `console.error` 失败痕迹 / 降级路径可见 /
peer 与宿主同一实例 / 各入口 `node --check`。

初版用手搓假 ctx, 盲审判为"生产的手写替身"; 实测也证了 —— 假 ctx 缺
`reflect.provide` ⇒ 真 TypertRemoteService 构造失败 ⇒ 网关半挂载, 而 apply() 照样
不抛 ⇒ 旧版 A18 把半挂载判成绿。改用真 Context 后这类半挂载必红。

**变异自检**(闸门判别力的唯一可靠证伪手段): `scripts/probe-a18-mutation.mjs`
把两类真实缺陷放回去 —— ①v0.13.3 形态(静态裸名 import) ②半挂载(网关构造被
打坏) —— 断言 A18 对二者**必红**、对当前形态**必绿**。有存活变异 ⇒ 闸门是戏。

### 机制防线 · G4 宿主语义契约闸

dtg 依赖约 18 条**宿主不承诺任何文档**的内部语义, 原先**只以源码注释形式存在**。
注释会随重构蒸发; 宿主一升级就可能失效, 而失效表现往往不是报错, 而是**静默变成
另一种行为**(裁剪失效 / 工具面变宽 / 返回值被拒) —— 正是 dtg 历史上最高频的
"静默失败"族。

`scripts/probe-host-contracts.mjs`(19 项)用**宿主真包**(@deepseek-ai/cordis +
dsh-tools + dsh-scope)跑行为实验 —— 不是 mock(mock 只能测 mock 的行为, 测不出
宿主真实现的漂移)。断言七组: ①restrict 未知名 throw(且报错点名未知工具, 不能是
TypeError 假绿) ②view(scope-key) 寻址 ③own 层豁免 restrictions ④restrictions
叠加=交集 ⑤scope 标签互通 ⑥lossless 契约 ⑦peer 单例性。已接入 `verify-track.mjs`
第⑤项 ⇒ 升级后跑一次即知哪条漂了。

纪律: 新增宿主语义依赖时, **注释与断言必须成对出现** —— 只写注释 = 下次升级照样
静默失效。

### 机制防线 · G2 发布物三方对账闸

发布链有三处产物(本地导出物 / npm 包 / GitHub Release 资产), 但此前**没有任何机制
保证它们一致**。后果实测: 本地 `release-out/` 长期停在 0.13.3 而源仓已 0.13.4 ——
v0.13.4 的全部代码都不在导出物里, 无人发现。根因: 导出器只做"源→导出物"的**单向**
断言。

`scripts/release-reconcile.mjs <version>` 做三方对账: 版本一致 / 字节一致(下载实测
sha256, 同算法)/ 服务端字段自洽(npm `dist.shasum` 是 sha1、GitHub `asset.digest` 是
sha256 —— **各自算法互不混比**, 跨算法比字符串会产出恒假断言)/ 件数与逐文件内容一致。

任一侧缺失 ⇒ **报红**(发布未完成), 不静默跳过 —— 静默跳过正是这道闸要消灭的病。

### 根因调研(91 个提交逐条读)

缺陷根因分布: 边界漏网 43% / 语义误解 29% / 发布链 23% / 验证缺口 11% /
流程缺失 9% / 契约漂移 0%(尚未被观测到, 不是安全)。

可复用的结论(详见 `docs/` 与维护文档):
1. **发布态与开发态漂移是断言链的设计盲区** —— 文本正确的导出物可以完全无法加载。
2. **开发态的 node_modules junction 会系统性掩盖发布态缺陷**。
3. dtg 依赖约 18 条**无文档承诺**的宿主语义, 只以注释形式存在, 宿主升级后全部可能失效。
4. **"同构副本"假绿在 dtg 历史上确证 3 次**, 最终以"提取共用模块"消灭, 而非"加一致性检查"。
5. **静默失败是最高频形态**, 且全部逃过现有观测手段(进程正常退出 + 服务端 canary 绿
   不能作为发布闸)。
6. **同一现象被修 3 次的教训**: 找到真根因的动作是"加可观测性定位到语义层",
   不是再改一次逻辑。
7. **单插件承担过多职责 ⇒ 缺陷形态退化为"形状×职责的接口错"**, 加固方向是加形状
   对账断言, 而不是继续加逻辑分支。

### 否决项(留着, 因为"当初为什么那样想"更有复用价值)

- **自带 peer 副本修 P0** —— 否决(双实例 ⇒ 裁剪静默失效, 更糟)。
- **降级用 `skipped` 放行** —— 否决(fail-open, 与自身原则矛盾)。
- **peer 缺失时卸面板** —— 否决(自断观测通路)。
- **锚点法当作终态** —— 盲审指出真正根因在宿主侧(`boot()` 未传 `bareModuleBaseUrl` +
  loader helper 写失败 ⇒ 裸名 import 无兜底), 锚点法是插件侧 workaround;
  已记录待提宿主上游工单。

### 探针

新增: `probe-peer-resolver.mjs`(21) / `probe-publish-install.mjs`(6) /
`probe-audit-archive.mjs`(26) / `probe-a18-mutation.mjs`(7) /
`probe-tool-returns.mjs`(35, 承接 v0.13.3 的 12/13 红项)。
既有 9 套全部更新以适配"假 ctx 需提供 profileContext"(P0 改为运行时解析后,
探针不给宿主锚点就会走降级 —— 那是降级姿态正确生效, 不是被测逻辑坏了)。

## v0.13.4 (2026-11-11) —— baseline 底线闸封死 composed 治理绕过洞

**缺陷(P0-B)**: 含 `dispatch_composed` 权限的 lead 孙代可经 `tools` 直传或自定义标签,
使孙孙代获得 baseline 高危件 —— `gateComposed` 的 keep-only 只与 `known` 求交
(全局行名在 known 里就直接放行), 不在 known 的件经补挂注册到 own 层, 而 own 层
豁免 restrictions ⇒ 双通道绕过负面清单。

**修法(双层防御纵深)**:
- **A 入口闸**(`executeComposed`): 组装面命中生效 `baseline_deny` 件 ⇒ 派发即报错,
  点名标签与件名(fail-loud 不静默剔除); baseline 以 `readConfig` 生效值为准。
- **B 兜底**(`gateComposed`): allowList 与 baseline 求差; 补挂循环对 baseline 件
  `continue` + warn + audit(`ev=composed-baseline-block`, `rec.baselineBlocked`)。
- `dispatch_composed` 单件豁免(两层同口径): 它是本通道级联机制(lead 标签设计;
  生产 config 的 baseline 含它 + lead 标签含它是并存现状), 豁免后风险闭环 ——
  孙代持有它也组不出任何 baseline 件。

**探针** `scripts/probe-baseline-gate.mjs`(29 断言)全绿: ①`tools=[moa_loop]` 报错零
spawn ②批量混入整批拒 ③正常标签(reader/literature/ocr/literature-lead)面不变
④baseline 含 `dispatch_composed` 时 lead 级联仍工作 ⑤覆盖表自定义标签含 baseline
件报错点名 ⑥兜底拦派发后配置变更场景(audit+rec 在案)。

## v0.13.3 (2026-11-11) —— lossless JSON 返回值修复批

**缺陷**: `dispatch_composed` 的 `wait=true` 路径每次都返回
`tool "dispatch_composed" returned invalid output: value is not lossless JSON`
—— 子代理其实已派出、结果也正常异步投递, 只是**工具返回值**非法。

**根因**(宿主真函数判定, 非推断): 宿主 `dsh-tools/lib/pipeline.js:797` `snapshotToolValue`
对 execute 返回值做 `snapshotJsonValue`; `dsh-util-values/lib/index.js:676` `walkJsonValue:701`
判定「任一属性值为 `undefined` / `NaN` / `±Infinity` / `-0` ⇒ 整个对象非法」。
v0.13.2 的 wait 路径把 `stopReason` / `error` 以 `undefined` 写入返回值 ⇒ 必炸。
非阻塞路径因为不写这两个键而正常 —— 这正是缺陷只在 `wait=true` 出现的原因。

**修法**(双层):
1. wait 路径缺值一律**省略键**(探针证明: `undefined`=非法 / 缺失键=合法 / `null`=合法);
2. 出口统一净化 `toLossless()`: 所有 execute 返回路径都过一遍 ——
   剔 `undefined`、非有限数转 `null`、数组内 `undefined` 转 `null`、
   丢弃非普通原型的对象(宿主句柄)。以后新增字段不可能再踩这个坑。

**新增探针**(用宿主真函数, 非同构副本):
- `scripts/probe-lossless.mjs` (17 项) —— 真值表 + 阴性对照
- `scripts/probe-lossless-fix.mjs` (29 项) —— 从 `host.v2.mjs` **源码抽取**真实现, 防副本漂移
- `scripts/probe-label-drift.mjs` (23 项) —— 同标签/异标签/自定义标签的面决定性实验
- `scripts/probe-composed-wait.mjs` (21 项) —— **端到端**: 跑真实 `execute()` 的
  `wait=true` 路径, 让假子代理 resolve 出生产同款结果(缺 `stopReason`),
  拿实际 return 的对象过宿主真函数判定; 含阴性对照(旧形状仍判非法)

**附带修复: 失败子项渲染打 ✗ 而不是 ✓**
子项刻意不带 `ok` 字段(不给显示目的污染数据形状), 旧渲染只判 `ok === false`,
于是失败子项渲染成「[dispatch_composed ✓] … 错误: spawn 失败」自相矛盾。
判定改为: 显式 `ok=false` ⇒ ✗; 否则有 `error` ⇒ ✗; 否则 ✓。
`test-render-logic` 22 → 25 项, 阴性对照: 判定改回旧形态 ⇒ 新增 2 条断言立刻报红。

**同标签面稳定性实测**(台账按面内容分组, v0.13.2 后 31 条):
最大一组 `allow=17 + 补挂 8 件` 跨 4.5 小时、19 次不同任务, **面内容零差异**。

**发布物**: 28 件; tag `v0.13.3`。
校验值(sha256/体积)见 **GitHub Release 页** —— 不写在本文件里:
本文件本身就在那个 tarball 内, 写进去会自指(改文档→sha 变→要重发→再改)。

## v0.13.2 (2026-11-11) —— 并行与续派面稳定批

修两个实测坐实的缺陷：**派单只能串行**，**续派后子代理工具面完全变掉**。

- **并行派单（此前做不到）**：宿主 `SubagentActivationSpec` 的 `delivery` 语义是
  「Parent delivery notifies the model; caller delivery only returns the result」。
  旧实现用 `caller` + `await run.result` → 必须等子代跑完，一次只能一个。
  改为 `delivery: "parent"` → **立即返回各子代理 id，完成结果由宿主异步投递给本会话**
  （与宿主原生 `subagent` 工具同范式：它也是 "immediately returns its id, the
  runtime notifies you when it finishes"）；
- **批量派单**：新增 `tasks[]` 参数，每项一个独立子代理（各自的 prompt / 能力面），
  一次发出、互不等待、互不影响；实测三个子代理的 allow 尺寸分别为 8/9/22 —— 面互不干扰；
- **续派面稳定（关键修复）**：子代跑完后再 `send_message` 续派 → 宿主 `coldResume`
  冷恢复 → **重新物化 agent** → `agent/created` 再次触发。旧实现首次创建时就把预挂
  删了，续派时认领失败 → 落回普通 deny 名单裁剪 → **工具面完全变了**（生产台账实测
  同一 agentId 的面从 109 掉到 5）→ KV 前缀失效、工具用不了。改为**预挂持久**
  （认领后不删，由 TTL 清扫兜底），续派命中同一份 allow 名单；
- **补挂源快照**：补挂（allow 名单里不在可裁集的名字，如 preset 行工具）原先读主会话
  **实时**面 → 主会话面一变（改 `main_deny` / pending 进件 / 新工具出现），补挂就补不上
  → 子代理面跟着漂移（实测同标签 `literature-lead` 的面在 23 与 25 之间跳）。
  改为派发时**快照**主会话的定义 → 子代理面与主会话此后怎么变无关；
- **台账可观测**：新增 `supplementedFromSnapshot` / `supplementedFromLive` /
  `claimCount` 三个字段 —— 能直接看出补挂走了哪条路、该子代理被认领了几次（即被续派过几次）；
- **回执渲染提取为共用模块**（`composed-render.mjs`）：原先 `host.v2.mjs` 内联 render +
  测试里一份"同构副本"，两份代码会漂移（改 host 不改副本 → 测试全绿而真 render 已坏）。
  现测试直接 import 真实现；断言从 7 条增至 22 条，覆盖异步 / 批量 / 超长落盘各分支；
- **发布链新增两条断言**：A2b「运行期相对 import 目标必须在包内」（`host.v2.mjs` 静态
  import 了 `./composed-render.mjs`，白名单漏了它 → 装上即 `ERR_MODULE_NOT_FOUND`）；
  A17 改为**先挖注释再查残留**（注释里提到旧包名不是漏改的标识符），并配端到端探针
  `probe-a17-comment-strip.mjs` 验证「字符串里的旧名仍被拦、注释里的不误伤」；
- **中文版流程图**（`docs/gating-flow.zh.svg`）：中文标签 + 明暗自适应
  （透明背景 + CSS 变量 + `prefers-color-scheme` 媒体查询），深底与浅底都清晰可读；
- **新增两个运行时探针**：`probe-composed-continuity.mjs`（续派面稳定：首次与续派的
  allow 名单必须一致，且续派须走 composed 分支而非普通 deny）与
  `probe-composed-batch.mjs`（批量并行：N 次 spawn / childId 互异 / 缺省非阻塞 /
  面互不影响 / `wait=true` 才同步），两者均用阴性对照验证过判别力。

## v0.13.0 (2026-11-11) —— 双语发布页 + 图示批

发布面按 `dsh-moa-native` 的模式重做：发布页拆成中英双文件，配套流程图与市场卡片图标。

- **双语分文件**：`README.md`（英文）+ `README.zh.md`（中文），两份章节一一对应，首屏互链。原先是单文件英文 + 尾部中文段；
- **图示**：新增 `docs/banner.svg`（标题横幅：全局工具集 → 策略闸门 → 岗位工具面）与 `docs/gating-flow.svg`（闸门流程图：agent/created → 六张名单合成 → role-briefs 分支判断 → tools.restrict() / 引导注入 / 提示段遮蔽 → 台账，右侧另示新工具三态闸）；图内文字纯 ASCII，中文仅存于 `<title>`；
- **市场卡片图标**：新增 `docs/assets/icon-180.png`（位图，awesome-dsh-plugin 的列表只收 GitHub 托管的位图，SVG 会被拒），由 `icon.svg` 放大居中而来；
- **文档事实核对闸升级**：断言脚本改为**双文件架构**（英文查 `README.md`、中文查 `README.zh.md`），合并断言必须两侧各查一次（否则中文版删掉声明而断言仍绿 = 假绿）；新增 30 项断言，含章节条目数两版一致、图文件真实存在、语言切换链接双向、**发布页不得含编码损坏字符**（U+FFFD）；断言总数 48 → 78；
- **切段工具修正**：段落切分原按固定 `\n#{2,3} ` 找结束标记，会把更低级的 `###` 也当结束 —— 于是 `## X` 在第一个 `### 1.` 处就截断、切出空段（假绿）。改为按起始标题的 `#` 数动态定级；
- **发布物扩充**：`package.json` 的 `files` 白名单新增 `README.zh.md`、`docs/banner.svg`、`docs/gating-flow.svg`、`docs/assets/icon-180.png`（26 件）。

## v0.12.1 (2026-11-11) —— 客户端模块注册 id 修复（发布阻断级）

v0.12.0 的包名统一批漏改了一处**客户端注册 id**，导致浏览器端整个 client 模块装载失败（面板不可用），已在被外部使用前拦截。

- **根因**：`client.js` 的 `window.__ModuleLoader__.load({ id })` 里的 id 仍是旧包名。宿主装载时取 `row.id`（= 包名）去查 `factories.has(id)`，不匹配即报 `loaded without registering "<包名>" via __ModuleLoader__.load` 并判定该模块装载失败。改名批的脚本把"插件 id"与"模块注册 id"当成同一契约一并保护了，但二者相反：模块注册 id **必须等于包名**；
- **三个 id 的契约（本批厘清）**：模块注册 id（`__ModuleLoader__.load`）**必须 == 包名**；`remote.$mount({ package })` == 宿主 `export const name`（插件名）；`slots.register({ id })` 是设置页槽位 id，与包名无关、不受约束；
- **为什么服务端 canary 抓不到**：宿主 `debug.json` 的 `clientModules.graph.entries` 取自 `package.json` 的包名，与 `client.js` 内部注册的 id 无关 —— 两者不一致时它反而显示"正确"。只有真正 eval 客户端源码才能发现；
- **补上客户端半冒烟**：新增 `scripts/client-smoke.mjs`（mock `__ModuleLoader__` / react / remote / slots 后 eval 客户端源码），断言模块注册 id == 包名、`$mount.package` == 宿主导出名、apply 成功、面板可渲染；已用阴性对照验证该探针对本次缺陷报红；
- **另有同批补的运行时探针**：`scripts/probe-save-runtime.mjs` 实调 `save()` 验真实落盘（静态断言看不见 `catch` 里的静默失败）。

## v0.12.0 (2026-11-11) —— 包名统一批（破坏性）

开发态包名由 `depth-tool-gate` 改为 `dsh-depth-tool-gate`，与 npm 发布名、GitHub 仓名三者统一为单一身份（与 `dsh-moa-native` 同范式），不再依赖导出器做身份改写。

- **改名范围**：标识符类 55 处 / 14 文件 —— `package.json` 的 `name`、宿主的 `export const name`、bundle patch 的插件行 `name` 与 8 处行内模块引用、客户端模块 id 与面板注册 id、文档与脚本内的包名引用；
- **刻意不改的两类**：插件 id 保持 `depth-tool-gate`（它是 patch 内部键、台账标识与服务名，与包名无关，改了会断掉既有台账的连续性）；运行时数据文件名保持 `depth-tool-gate.config.json` / `.lock.json` / `.usage.json` 与 `logs/depth-tool-gate/`（只有本插件读写，改名会丢掉既有策略配置、闸门状态与历史审计流水）；
- **安装方式变化**：profile 的 `package.json` 依赖键与 `dsh.profile.bundles` 条目名须一并改为 `dsh-depth-tool-gate`，`node_modules` 下的链接目录名同步改名（加载器按**包名**解析，目录名与包名不一致会装载失败）；
- **导出器适配**：发布态改写步骤由"旧名→新名"改为幂等保险（两态同名后本就是空操作），断言链改为按插件 id 匹配；
- **文档修正**：`docs/panel-guide.md` 的主会话保护集件数由 19 更正为 18（代码实数）。

## v0.11.2 (2026-11-11) —— 发布就绪批

发布审计后的修复与发布链路重建:

- **配置保存路径断裂修复**：上一批补丁因锚点不匹配而半应用，导致 `save()` 调用了未定义的函数 —— 面板保存会抛异常并被捕获，表现为"点了保存但什么都没变"。本次补齐定义与全部未落地项，并新增回归冒烟脚本(28 项断言，覆盖定义存在性/回落语义/落盘顺序/防御门/路径一致性);
- **发布导出器修复**：导出器在一致性检查阶段引用了一个从未声明的常量，导致运行必崩、发布包永远产不出来。移除该残留行后全链路通过;
- **发布态包身份**：开发态包名(本地开发链接名)与发布态包名(`dsh-depth-tool-gate`)解耦——导出时改写包名、补齐发布元数据(private=false / license / keywords / repository / homepage / bugs / engines / peerDependencies / main / icon / publishConfig)，并同步改写插件行的裸包名(加载器按包名解析，不一致则装载失败);
- **断言链扩展**：新增发布态身份与元数据齐备性、发布包不含开发态专属文件、插件行名与包名一致三项断言; 修正两处成功日志的判据(比较形式错误导致绿灯被吞);
- **profile 目录按 profile 解析**：配置/闸门/频率快照此前硬编码 `profiles/web` —— 桌面版、headless、测试等 profile 会读写错 profile 的策略与台账(跨 profile 污染)。改为优先取宿主给出的当前 profile 目录，缺省仍回落 `profiles/web`(既有文件位置不变); 频率快照载入时机从模块加载期移入插件启动后(此前拿不到 profile 上下文);
- **缺省名单修正**：内置负面清单里的定时任务工具名改为宿主实际注册名(`schedule_edit`/`schedule_view`)，并移除已退役工具族(14 个 `agent_teams_*`，宿主与源码中均已不存在); 缺省名单与配置模板此前不一致(54 条 vs 40 条)且模板自称"与内置一致"——现由内置表生成，并加断言防止再次漂移;
- **死代码清理**：移除未使用的导入与一个从未被引用的常量(后者还在泄露本机工具清单);
- **发布页重写**：README 改为面向外部读者的完整说明页(标题/副标题/问题对照表/七项机制/安装/配置/隐私/文档索引/中英双版), 并修正原文把面板写成"5 Tab"(实为 7 Tab)等事实错误;
- **发布元数据补齐**：新增 MIT 许可证文件; 中英文 locale 描述更新为发布态实际包含的三个 preset; 文档随包清单收敛为五篇面向使用者的文档。

### 同一版本的后续收口（同日）

- **台账事件字段统一**：治理事件的标识字段此前写作 `event`，而面板的红行判定只认 `ev` —— `preset-denied` 因此从未显示为红行。已统一为 `ev`，并把角色引导缺失事件的时间戳由毫秒数改为 ISO 串(此前在面板显示为 1970 年);
- **主会话回落可见化**：主会话未配 `main_preset_allow` 时会回落共用键 `preset_allow`，而该键在主会话侧按 keep-only 生效(`main_deny` 不叠加) —— 语义与子代理侧的"豁免"相反。已加宿主告警，使该回落不再静默;
- **面板来源标注中性化**：来源列的"自研"与内部实现名改为第三方插件/外部模型等中性表述; 角色下拉默认值改由实时注册表派生(此前硬编码一个本包并不存在的 preset 名);
- **内部资产归入 `internal/`**：npm 包已是零本机痕迹，但仓库里还有 44 个"不进 npm 包、却被版本控制跟踪"的文件(考古报告、手术脚本、内部发布手册、一次性测试预案) —— 一旦仓库开源，它们同样公开。现已归入 `internal/` 并加说明; 两个手术脚本的目标 patch 与插件目录改为参数化，行内引用锚同时匹配开发态与发布态两种形态;
- **源 patch 改用裸包名**：行内模块引用此前写本机绝对地址，发布态才由导出器改写 —— 即开发态从未验证过发布态的解析方式。改为源侧直接用裸包名后，开发态与发布态走同一条解析路径(沙箱实测: 四个 preset 各自注入本岗位引导、零解析失败); 导出器的改写步骤相应扩展为同时处理三种源形态，且对已改写形态幂等;
- **发布页事实核对回归闸**：新增脚本把"可机器核对的文档事实"固化为断言(48 项: 保护集件数、面板 Tab 数、能力标签件数与其 MCP 依赖数、未知标签的真实行为、名单合成顺序、中英双语一致性、安装四步齐备、首屏可达性等)，避免同类错误复现;
- **随包文档按实现重写**：台账字段字典按实际写入的字段名与状态取值重写(原先描述的字段名与"重启清零"说法与实现相反)；锁文件三态按实际写入值说明；排障表补"主会话工具面意外变窄"的排查项。

## v0.11.1 (2026-11-10) —— host 健壮性热修

多路盲审发现并修复的主机侧缺陷(修复级变更):

- **落盘死码修复**：`usageStats()` 里 `flushUsage()` 原置于 `return` 之后——"拉取即落盘"从未真正执行。改为先落盘再返回结果;
- **合法性回落(pick-first-valid)**：主会话按角色名单改用"取第一个合法数组"回落，取代 nullish 回落 —— 主键存在但非数组时不再遮蔽合法的共用键(原写法会静默放行);
- **落盘文件防御**：频率快照属不可信输入面，加版本门、逐条类型校验(计数数值化、会话条目校验 id)与载入即截断回容量上限，坏条目丢弃并计数告警，绝不进内存;
- **失败也清脏标记**：落盘失败后仍清理脏标记，避免同步热路径每次调用重试(内存数据不丢，下个周期整体重落);
- **配置逐键归一化**：保存时对主会话按角色名单逐键校验(只收"键→非空字符串数组")，坏键丢弃;
- **配置损坏可见化**：读取失败的告警与台账事件合并入同一节流窗口(防损坏期日志刷屏)，并在损坏态下由面板保存时记一条"配置重建"事件。

## v0.11 (2026-11-10) —— 面板重组 + 落盘批
- Tab 重组: main_deny 编辑迁入 Tab1; Tab🧭 主功能=preset_deny + 新增主会话按角色禁用(main_preset_extra_deny/allow, host gateMain 拆键优先+回落 v0.7 共用键, 两场景分离); Tab👥 更名子代理按角色;
- usageStats 落盘: per-session 分桶(cap500 淘汰最旧, id 防御式取) + usage.json 快照(启动载入/每500次调用/拉取时写, 重启不清零) + 面板按会话明细折叠表;
- config-corrupt 台账事件(60s 节流, 审计发现的"静默 fail-open"止血);
- 说明客观化: ORIGIN/GROUPS 全面改中性一句简表, 叙事/裁决理由迁移 docs/tool-annotations.md 六节(含 explain_gate/yuanbao 补录); 版本号单一权威源=package.json(host status 下发 PKG_VERSION+protected_main, 客户端镜像降级为回退);
- stale 逐件归因(域会话专属 MCP/来源停用可复装/疑改名 三态, 图例与闸门页双呈现); 全部时间戳本地化显示(存储恒 UTC ISO); 台账/闸门文案白话化+ev 事件行; 下栏来源筛选下拉; 全工具逐件🔍解读(含已裁决件);
- schedule 组名单修正(schedule_edit/view 真名)。

## v0.10 (2026-11-10) —— 面板可用性改进
- Tab1 双栏可折叠(上栏默认收起+计数摘要, localStorage 持久化);
- 下栏两层独立勾选(子代理禁/主会话禁, PROTECTED_MAIN 19 件客户端镜像置灰防"保存成功却没生效"回弹);
- 解读提示词生成器(🤖批量≤8/批+🔍逐件; 自包含模板: 查自身工具定义/禁编造 need-info/untrusted 隔离/VERDICT 机读四路);
- 闸门 pending 行四键化(+主会话禁两步独立报错+解读); 层级图例两轴(看不见=未挂载/组装面; 被拦=main/baseline/pending/stale/locked);
- 文案口径修正: "主会话/depth-0 完全不动"失实句删除; 保存语义统一"之后创建/恢复生效, 运行中不变"(agent/created 实证);
- package.json 0.8.1→0.10.0(版本三源再统一), description 去 sci-lite(core3 定稿); ORIGIN 补 explain_gate/yuanbao-search。

## v0.9 (2026-11-10) —— 面板与治理大版本
- preset_deny 访问控制(fail-closed)/usageStats 频率采集/explain_gate 诊断工具/Tab6 主会话与访问+Tab7 调用频率;
- 发布链导出器 v2(staging+原子改名+core3 裁剪+A1-A8 断言); 两轮 MoA 盲审修复(P0×3)。

## v0.8.2 (2026-11-10) —— 发布即炸修复批（npm pack 断言通过）
- package.json: exports 补 ./role-briefs（§7.4）; files 补 role-briefs.mjs+agents-briefs/（§7.5 发布即炸:
  此前 npm 发布后 role-brief 全线静默失效）; files 删 docs/（发布包不含开发文档）; version 0.4.6→0.8.2
  对齐真实代码状态（D7 版本三源分歧: versions.md=v0.6/host 头注=v0.3/package=0.4.6 → 本批统一）;
- role-briefs.mjs: 缺失可见化（双缺/section 失败记 audit.jsonl 台账事件 role-brief-missing, 面板可查）;
  DSH_HOME env 对齐 host.v2.mjs（§7.2 沙箱 profile 读错 config 修复）;
- 第 0 小时探针批次 4/4 通过: P-a 相对说明符（生产 patch 3 处先例实锤）/P-b bundle patch 数组（app-boot
  bundlePatchFiles 源码）/P-c 三源分歧确认/P-d session/event 全局可达（dsh-acp:1077 先例→频率 Tab 成立）。

## v0.8 ~ v0.8.1 (2026-11-08~09) —— preset_allow 正面清单制 + 外送补挂
- preset_allow[preset] → restrict({allow}) 正面清单制（名单即意图，main_deny 不再叠加）;
- preset_extra_deny 负面叠加制; preset_supplement 外送会话按名单补挂缺件（复用 composed 机制）;
- cordis-router 实测 6/19→3/19 件（[dtg-role-brief] 自治理日志）。

## v0.7 (2026-11-08) —— role-brief 正面清单自治理 + hand-off 修复
- role-briefs.mjs 行集激活时读 config.preset_allow[brief] 直接 restrict({allow})（身份与裁剪同源）;
- 手开会话 header.agentPreset 身份误判修复（详见 host.v2.mjs v0.7 注释段）。

## v0.6 (2026-11-08, commit 10757f1) —— role-briefs 引导定制体系 + 全域遮蔽

- **role-briefs.mjs 引导注入模块**: preset 行内 `config: {brief: <role>}` → sp.section 注入
  `agents-briefs/_common.md`(9 条通用铁律, 自 AGENTS.SUBAGENT.md 演化)+岗位段, 段名
  `role-brief:<role>`; 文件缺失 warn 跳过不炸会话; briefs 改文件新子代即时生效零重启;
- **16 preset 全接入**: 生产 patch 13 域段 agent-instructions→role-brief(断供 40KB user-message
  注入; 机制依据=源码定案: user-global 层无 config 开关且走 user-message 通道, candidates
  与段遮蔽均不可达) + bundle 3 preset persona 内联铁律删除收敛到 _common.md 单点维护;
- **13 域段补挂 prompt-slim**: 遮蔽清单全 preset 生效(scripts/promptslim-surgery.py 幂等);
- **实测**(生产 canary 两路): sci-worker 自报五项全局段(重启纪律/goal/MCP resource/Web
  GUI/DSH checkout)对比上轮全部消失, 引导正文降至约一千字; cordis-sub 自报 persona=瘦版、
  9 铁律+岗位段来自 role-brief、派孙工具在面; 每子代引导 40KB→~2.2KB, 系统提示再省 ~4.6KB;
- **文档规范化**: README 现状导向重写 + docs/DEV-SOP.md(开发路径速查) + docs/devlog.md
  (日常记录); host.mjs 退役;
- **连带修复·autoDenyNew 行集误拦**: lock 闸门把 bundle 行集工具(read/write/edit/glob/
  grep/bash/pwsh/job 三件/todo_write/web 两件/present/skill/read_image/cordis_inspect
  两件/delegation 四件/workflow 共 23 件)首见记 pending 无人裁决→默认拦截, spawn 子代
  文件能力系统性缺失; 裁决脚本批量放行(备份 lock.json.bak-pending-rescue, 复核
  pending=0/seen=122)。**教训: preset 行集上线/变更时其工具会整批进 pending, 须主动裁决
  或考虑行集豁免逻辑**(待办)。
- **[2026-11-08 追加, commit fc07800] router-probe 更名 cordis-router 转正 + render 修复**:
  preset-router-probe→preset-cordis-router(入 cordis 基座家族: deep=执行型/sub=子代/
  router=编排型), brief git mv 同名, docs 更名注记; host.v2.mjs 的 list_agent_presets
  render 由 `⚠broken` 三字改为 `⚠broken: <原因原文>`(此前丢弃 registry auditRows 诊断
  全文——router-probe/sci-bio 两例 ⚠broken 但 preset_dispatch 实测均可装载 13s/3s, 具体
  pending 行待重启后原文定位)。沙箱 test 3081: dtg-role-brief 注入 cordis-router 引导
  1443B, 三查零命中。

## v0.5.1 (2026-11-08, commit 0656e9c) —— 子代理系统提示去冗余

- **prompt-slim.mjs 遮蔽插件**: preset scope 内同名空 section/context 遮蔽全局注入
  (机制=dsh-system-prompt :248-251 scoped shadow + :120/:157 空段渲染过滤);
- **遮蔽清单**: 9 section(deliverable/web-surface/long-goal-convention/sibling-dispatch/
  harness:source/bash-terminal/restart-guard/mcp-resource-servers/mcp:research-tools)
  + 3 context(app:web-surface/harness:source/skill-scout-hint), 挂 dtg-shell/cordis-sub/
  sci-lite 三 preset;
- **实测铁证**(2026-11-08 13:15 北京, 进程 13:14:27): provenance 4 次组装(含子代 dc-cec77aa7)
  各段平均字节精确=3/4×full(978=3/4×1304 等 9 段全中)——子代贡献空文本, 渲染期被过滤,
  模型不可见; **子代系统提示瘦身 ~4.4KB**;
- 保留(子代必需): context:file-reference(@路径, 有 read 的面)/approval/sandbox/
  working-directory 动态段/persona 行集段。

## v0.5 (2026-11-08, commit a521f8b) —— 能力标签面板化 + 检索带队

- **Tab5「🧪 能力标签」面板**: 标签卡编辑(textarea 逐行)/新增删除/来源标注(内置/自定义整体
  覆盖警示)/⭐可带队徽标/恢复内置; host 配套 status 返 default_capabilities + save 三态
  透传(显式表→校验落盘/显式 null→清键恢复内置/未给→保留现值);
- **literature-lead 标签**: 23 件=文献检索 22+派单权(检索面 foreman 化);
- **AGENTS.md 入档**: 「拉起组合速查」补 dispatch_composed 第四通道(临时最小工具面);
- **通俗文档**: docs/biomedical-analogy.md(生物医学类比——器材管理/临时实验台/带教/记录本);
- **名称定案**: 保留包名 dsh-depth-tool-gate, 面板中文标题扩为「子代理工具面·闸门与组装台」;
- **生产冒烟**(2026-11-08 11:45 北京, 进程 11:34:24 加载): literature-lead 面 23 精确
  (审计 dc-15ad5f79: allowed=17+补挂6→visibleAfter=23), 检索工具+zotero 实调+派单权
  全在手 ✓; Tab5 渲染待用户刷新页面确认(数据通路=default_capabilities 已随 status 返回);
- 工程教训: JSON 工具参数转义双层削漏——heredoc 传反斜杠字面量必用 chr(92) 构造。

## v0.4.7 (2026-11-08, commit f0f0b1f) —— lead 标签系（子代再派发）

- **reader-lead 标签**: reader 面(8)+dispatch_composed(共 9 件)——该子代可再派一级动态组装孙代;
- **maxDepth 条件放行**: allow 含 dispatch_composed 时 +1 级联预算(总闸 maxDepth=12 仍管辖);
- **沙箱合规**(01:5x 北京): test patch dtg 行改直挂仓内源码(修复 bundle 化后沙箱链路断链) →
  3081 结构闸(5 条加载日志/零 error)+语义闸(标签表/maxDepth 表达式验证)双绿;
- **生产两级派发实测**(2026-11-08 04:07 北京, 用户批准重启后, 进程 02:05:12 加载 v0.4.7):
  - 正例: A(reader-lead, depth=1, allowed=2+补挂7→面9)直读 package.json ✓ → A 面内派孙代
    B(reader, **depth=2**=maxDepth 条件放行铁证, 面8)读 versions.md ✓ → A 汇总回主会话 ✓
    全树闭环: 主→A→B→A→主;
  - 负例: reader 子代(无 lead)面内 dispatch_composed **不可见**(allow 名单本身不含,
    级联在工具面层即被阻);
  - headless 沙箱功能闸探明不可行(出厂路由 deepseek-official 无凭证, 生产 zai 凭证不跨
    profile), 功能实测以生产为准(fail-open 兜底)。
- 流程教训: 本版 host 改动曾未经沙箱直接发起生产重启被用户拦停——补救=goal-4488b9ab
  +沙箱链路重建+双闸重验后获批准; 测试预案 docs/v047-two-tier-dispatch-test-plan.md。

## v0.4.6-bundle (2026-11-08, commit 103b67c) —— 整体打包

- **自包含 bundle**: 包内 cordis.patch.yml 收编插件行 + cordis-sub/sci-lite/dtg-shell 三 preset
  (自生产 patch 手编段 335 行迁移, 原样保缩进); package.json 升 dsh.bundle.patch + files +
  locale/icon exports; locale/{zh,en}.json + icon.svg(原创三层闸门图)
- **生产切换**(2026-11-08): 手术删生产 patch 旧注册段(带备份) → install_bundle applied(以本地开发仓链接形态登记进 profile) → 重启
- **bundle 形态回归**(2026-11-08, 审计可查): reader 面 allowed=1 + supplemented=7 → visibleAfter=8 精确匹配; preset 注册表完整
- 遗留清理项: 旧运行位副本(已无注册行引用)与同步映射的对应条目过时待清理; profile dependencies 残留一条来自已退役插件时代的依赖(未挡路待观察)

## v0.4.6 (2026-11-08, commit f9aa4a2) —— 动态组装机制打通

- **三处根因修复**(dsh-tools/dsh-scope 源码定案):
  1. `view(scope)` 参数=scope key(agent 对象)——传 ctx 则 chainLayers 空链恒读纯全局层;
     v0.4.5 及以前 `view(sctx)` 全部错参(visibleAfter 恒 89 之谜), 六处改传 agent
  2. 补挂通路: `sctx.tools.register`(属性不存在)→`tools.register`; 定义来源
     `mainTools.ctx.agent`(不存在)→任意实例 `view(mainAgent)`(ScopedLayers 单例按键寻址)
  3. spawn 绑定 cordis-sub→**dtg-shell 空壳**: preset 工具行在子代 own 层裁不掉;
     空壳面=全局层×allow裁剪+补挂 own 层
- **生产正反对照实测通过**(2026-11-08 00:25 北京, audit dc-8330168d):
  reader 面 allow=8 → allowed=1(全局层仅 working_directory)+**supplemented=7**
  (web_fetch/web_search/read/read_image/glob/grep/todo_write)→ visibleAfter=8 精确匹配;
  子代实测 read 正向成功, shell/terminal/write/edit/mcp__zotero__search 全部不可见
- 主会话 visibleAfter 修复后正确读数 109(=89 全局+20 主会话 own 层)
- 沙箱盲区修复: test profile 此前从未注册 dtg → 补 insert 块(3081 三轮全绿)
- 已知残留: dtg-shell 的 tool-skill 行给子代挂 skill 工具(小面, 本次冒烟未见=skill 注册
  可能也走 own 层裁不进 allow, 待下次多标签冒烟观察)

## v0.4.5 (2026-11-07, commit f367448)

- known/allowList/dropped 变量缺失修复(v0.4.5 改写时误删); 修复后未及冒烟——
  实为机制错参未定案, v0.4.6 才真正打通

## v0.4.4 (2026-11-07, commit 38ba39e)

- **main_deny**: depth0 主会话裁剪(agent/created 覆盖), 14 llm-shim 工具裁, 面=88
- **sci-lite**: 文献细粒度 preset(research-tools+zotero+web/fs/job/shell/todo), 82 工具 deny
- **dispatch_composed**: reserved childId+restrict({allow})+补挂双轨——**机制不可行**(preset 层工具不在 restrictableNames, 7 轮冒烟实锤)〔v0.4.6 已推翻此结论: 不可行是 view 错参+绑错 preset 所致〕
- **goal 自动化**: create_goal 同名 shadow 官方版——**NamedEntries 冲突不可行**, 留档待事件监听方案
- 沙箱验证: v0.4.1/v0.4.3/v0.4.4 三轮 3081 全绿〔注: test profile 当时未注册 dtg, 结构绿≠功能验证〕

## v0.3.4 (2026-11-07, commit 7c80769)

- list_agent_presets 修复: remoteExportList() 返回 {presets} 直接透传(去双层包装)

## v0.3.1 (2026-11-07, commit d0a631f)

- lock 首建构语义修正: 拦新不拦旧(33 存量工具误 pending 修复)

## v0.3 (2026-11-07, commit 7ca1631)

- lock 版本闸门+snapshot+rule+forced 标记+list_agent_presets 工具
