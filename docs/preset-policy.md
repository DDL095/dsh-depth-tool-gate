# preset 工具面配方（Preset Tool Policy）—— 每 preset 一份配置

> 状态：**设计草案 v0.3**（未实现）。待裁决项见 §9。
> 取代 `tool-modules.md` v0.2 的「统一通道求值」路线（该路线已被四路盲审否决）。
> 证据基线：2026-11-13/14 实测 + 源码核对 + 五路异构盲审（`<dev-workspace>/moa-runs/dtg-v03-review`）。

---

## 1. 为什么要做（实测根因，不是推测）

### 1.1 生产上正在发生的两个真实故障

**故障 A：域 preset 自己的工具被治理闸门整批误杀。**

2026-11-13 23:35 北京实测：`preset_dispatch(preset=illus-deep)` 开出的会话**只有 60 件工具**，
其中 `mcp__illustrator__*` 67 件、`mcp__illustrator-vec__*` 29 件**一件都不可见** ——
而该 preset 的岗位引导明确承诺「Illustrator 绘图域，67 绘图工具」。

台账逐字坐实（`~/.dsh/logs/depth-tool-gate/audit.jsonl`）：

```json
{"preset":"illus-deep","depth":1,"denied":154,"pendingDenied":["mcp__illustrator-vec__…","mcp__illustrator__…"],"visibleAfter":60}
```

**故障 B：域 preset 的工具面被裁掉 90~95%，且各域不一致。**

| preset | 声明应有 | 实测面 | 差集 |
|---|---|---|---|
| illus-deep | 156（原生38+域MCP96+…） | **60** | −96（域工具全灭） |
| word-deep | 174 | 174 | 0 |
| excel-deep | 113 | 113 | 0 |
| ppt-deep | 57 | 57 | 0 |
| cordis-router | 20 | 20 | −1（yuanbao 漏网） |

同构的 4 个域 preset，3 个完好、1 个全灭 ⇒ **不是配置疏漏，是机制缺陷**。

### 1.2 根因链（每一环都有实测/源码支撑）

```
① preset 行注册的工具落在 preset 层 = agent 的父层（非 own 层）
   ⇒ 工具名进 view(agent).restrictableNames
   ⇒ 它同时出现在「可裁面」里，dtg 把它与全局工具一视同仁
        证据: dsh-tools/lib/index.js:489-491（继承层全部进 restrictableNames）
              dsh-agent-preset-registry/lib/index.js:686（bindScopeParent(agent, generation)）

② syncLock(lock, known, cfg) 把 known 里所有没见过的新名一律建 pending
   ⇒ preset 自带工具全部落进 pending
        证据: host.v2.mjs:356-374（新名 → state:"pending"）

③ pendingDeny() 无差别并入 deny 集
   ⇒ 域工具被自己的闸门杀掉
        证据: host.v2.mjs:376-380、382-388（effectiveDeny = (baseline ∪ pending) − exempt ∪ extra）
```

**量化（生产 lock 409 件逐件统计）**：

| 集合 | 件数 | 说明 |
|---|---|---|
| lock 总计 | 409 | |
| 全局层 G | 62 | |
| preset 层 P | 347 | |
| **pending** | **280** | |
| pending ∩ baseline_deny | **0** | ⇒ 与用户配置无关 |
| **pending 中的域工具** | **278** | illustrator 96 / word 120 / excel 59 / ppt 3 |
| **G ∩ P** | **0** | 19 个 preset 全域无交集 ⇒ 分层判定零歧义 |

⇒ **278 件误杀 100% 由 autoDenyNew 自动闸门造成，用户一条配置都没写。**

### 1.3 为什么 word/excel/ppt 侥幸没坏

`preset_allow` 实际扮演的是**「pending 闸门的豁免通道」**，不是「白名单」：
word-deep 的 allow 列全 120 件、excel-deep 列全 59 件、ppt-deep 列全 3 件 ⇒ 未被裁；
illus-deep 的 allow 只列 6 件画廊工具 ⇒ 96 件 illustrator 一件未列 ⇒ 整批被裁。

⇒ 现状要求用户**逐件抄写每个域 preset 的全部 MCP 工具名**才能保住能力。
MCP server 一升级就得重抄 —— 这是不可持续的配置形态。

---

## 2. 机制层事实（源码级，方案的地基）

| # | 事实 | 出处 |
|---|---|---|
| M1 | 工具注册三层：全局层（profile 顶层 insert）/ preset 层（preset config.plugins 行，= agent 父层）/ agent own 层（agent.ctx 补挂） | dsh-tools:477-501 |
| M2 | `restrictableNames` = 全局层 + 祖先层；own 层不进 | dsh-tools:489-491 vs :497-501 |
| M3 | 可见性 = 层链交集 `layers.every(l => l.admits(name))`；任一层 deny 即不可见 | dsh-tools:492、:391-395 |
| M4 | `restrict({allow})` 裁 inherited；allow 名单外的 inherited 件被裁；own 层裁不掉 | dsh-tools:453-468、:497-501 |
| M5 | `restrict()` 落在**调用方 ctx 所属层**：从 agent.ctx 调 ⇒ 落 agent own 层（只对该 agent 生效，不下传子代）；从 preset 内插件 ctx 调 ⇒ 落 preset 层（**污染该 revision 全部 agent**） | dsh-tools:467 → dsh-scope:189-203 |
| M6 | 子代绑定：显式 `agentPreset` ⇒ 独立 mount 自己的 preset；未指定 ⇒ `composeFrom` 继承父的 preset 层 | dsh-subagent:349-382、registry:717-728 |
| M7 | `agentPresets.composedPreset(ctx)` = 该 ctx 实际绑定的 preset id（**官方只读入口**，沿 generationFor→scopeParentOf 解析） | registry:733-735、:566-570 |
| M8 | `view(scope)` 返回四键：`visible` / `registrations` / `knownNames` / `restrictableNames` | dsh-tools:502-507 |
| M9 | `registry.generations` 是**私有 Map**，无「按 preset id 取 scope key」的公开入口 ⇒ 面板无法靠 `view(presetScopeKey)` 推导面 | registry:511-537（私有字段） |
| M10 | `run_code` 是 PTC 保留传输，**不注册进工具表、不受 restrictions** ⇒ keep-only 不影响它 | dsh-tools:440、:463；dsh-tool-executor-ptc:1755-1758 |
| M11 | `restrict()` 校验原子：allow/deny 名单里的名字必须全在 `restrictableNames` 内，否则 **整体 throw**（空名单/未知名/run_code 同） | dsh-tools:464-466、:458 |
| M12 | 宿主**没有**任何「声明 preset 完整工具面」的键；行级 `toolFilter` 已被官方移除并 throw | dsh-agent-preset:13-19；dsh-tool-subagent:346 |

---

## 3. 方案：四层命名 + 来源归属 + 每 preset 三条通道

### 3.1 先消歧：四个「面」必须分开命名（盲审共识）

现状文档里「面」一词混用四个集合，导致每次讨论都在错位。定名：

| 名 | 定义 | 宿主对应 |
|---|---|---|
| **注册面** registered | 该 scope 看得到的所有工具名 | `view(scope).knownNames` |
| **可裁面** restrictable | 可被 `restrict()` 裁掉的部分（全局层 + 祖先层） | `view(scope).restrictableNames` |
| **有效面** effective | 层链交集后**实际可见**的集合 | `view(scope).visible` |
| **归属** origin | 每个工具名的来源：global / preset:<id> / agent | 新增（§3.2） |

### 3.2 新增核心原语：来源归属表

**这是整个配方能成立的前提** —— 一旦知道「这件工具属于哪个 preset 自己声明的」，
就能同时解掉三个问题：不被自动闸门误杀（D1）、不必逐件抄进 allow（D2/§1.3）、能自动归类（§3.5）。

**归属的来源与获取**：

| 归属 | 判定依据 | 可靠性 |
|---|---|---|
| `global` | 出现在 `view(undefined).knownNames` | 运行时权威 |
| `preset:<id>` | 出现在该 preset 某 agent 的 `view(agent).knownNames` ∖ 全局层 | 运行时权威（**实测可行**） |
| `preset:<id>`（静态兜底） | preset 块声明的 MCP `serverName` ⇒ 该 server 全部 `mcp__<server>__*` | 静态（未 mount 的 preset 也能推） |

**为什么必须两路并行**：
- MCP 工具的真实名字由 server 的 `tools/list` 运行时决定，**静态推不出**（只知 server 名）；
- 但静态声明能覆盖**尚未 mount 的 preset**（面板要能列出全部 26 个 preset，M9 坐实无 scope key 可查）。

⇒ 落盘 `origin.json`（profile 目录，与 config/lock 同级）：

```jsonc
{
  "version": 1,
  "updatedAt": "...",
  "presets": {
    "illus-deep": {
      "servers": ["illustrator", "illustrator-vec"],   // 静态：patch 声明
      "tools":   ["mcp__illustrator__create_document", "…"],  // 运行时观测校正
      "native":  ["subagent", "subagent_fork", "…"]     // preset 块内的原生插件行
    }
  }
}
```

★ 文件名**不带插件前缀**（就叫 `origin.json`，不带旧包名前缀）：
发布链 A17 断言「发布物不得残留旧包名」，其白名单只登记了 `.config.json` /
`.lock.json` / `.usage.json` 三个运行时数据文件 ⇒ 若新文件沿用旧包名前缀
⇒ A17 报红 ⇒ **发布链被拦死**（实测踩到，已用基线副本对照确认为真回归）。
选「不起旧包前缀」而非「给 A17 加白名单」—— 白名单是发布链的**约束登记处**，
随意放宽会削弱该断言；而 `origin.json` 不带前缀无语义损失（同在 profile 目录）。

**归属表的写入时机**：每次 agent 创建时（dtg 已有 `agent/created` 钩子），
取 `view(agent).knownNames ∖ view(undefined).knownNames`，配合 `composedPreset(ctx)`（M7）
判定该 agent 的有效 preset ⇒ 增量并入该 preset 的归属集。
⇒ 归属表随 preset 换代 / MCP 升级自动校正，不需要人工维护。

### 3.3 每 preset 一份配置（用户要的「专有工具过滤配置」）

```jsonc
{
  "preset_rules": {
    "illus-deep": {
      "deny":   [],          // ① 显式禁用（永不被任何豁免覆盖）
      "exempt": ["auto"],    // ② 豁免哪些自动机制
      "allow":  null         // ③ null=不启用严格面；数组=启用 keep-only 正面清单
    }
  }
}
```

| 通道 | 语义 | 强度 | 谁可写 |
|---|---|---|---|
| ① `deny` | 用户显式禁用该 preset 内的这批工具 | 最强，**无豁免** | 用户（面板勾选） |
| ② `exempt` | 豁免自动机制：`"auto"`=autoDenyNew 自动闸门（**本期只支持此值**） | 作用域受限 | 用户 |
| ③ `allow` | 严格 keep-only 正面清单（**可选，默认不启用**） | 最强 | 用户（面板生成） |

**三条通道互相独立**（盲审共识：不同语义不得合并进同一张表的不同解释）。

★ **与 `preset_allow` / `main_preset_allow` 的关系（裁决③ 后的边界划分）**：

`preset_rules` 是**新增的、面向用户的现代接口**；`preset_allow` / `main_preset_allow` 是**存量键**。
两者**不做字段合并**（避免又一次双语义），而是分两层：

```
最终 deny 集 = (baseline_deny ∪ pending ∪ preset_extra_deny[p])
                ∖ preset_allow[p]                 ← 存量：子代侧豁免（语义不变）
                ∪ preset_rules[p].deny             ← 新增：显式禁用（无豁免）
                ∖ (preset_rules[p].exempt 含 "auto" ? pending : ∅)
```

| | `preset_allow` / `main_preset_allow`（存量） | `preset_rules`（新增） |
|---|---|---|
| 作用 | 旧通道的豁免 / 正面清单 | 显式禁用 + 自动机制豁免 + 可选严格面 |
| 是否被 §10 拆键影响 | 是（`main_preset_allow` 显式化） | 否 |
| 优先级 | 存量语义**先算**，`preset_rules.deny` **后叠加**（最强者胜） | — |

⇒ 两条线并存期行为可预测：**`preset_rules.deny` 永远赢**（它代表用户最新、最明确的意图）。

### 3.4 来源感知的闸门（修 D1，也是 P0）

```
pending 集合 := { 新见工具名 } ∩ origin == global
```

- 域 preset 自带工具（`origin=preset:<id>`）**不进 pending** ⇒ 不被自动闸门误杀；
- 用户在 `preset_rules[preset].deny` 里显式禁的 ⇒ 照禁（尊重「所有工具都可禁用」原则）；
- **审计不盲**：preset 层新名仍写进 lock，但标 `state:"preset"`（只记账 + 面板可见，不进 deny 集）
  ⇒ 避免「P0 单独上线 ⇒ 审计盲区」这一 fail-open 摆钟。

### 3.5 面推导与自动归类（修 D3/D4）

**面推导**（面板自动填，用户不写工具名）：

```
natural_face(preset) = 全局层 G  ∪  归属集 origin=preset:<id>
```

- 全局层那 62 件是跨 preset 共享的主战场；
- 域工具那 301 件天然属于各自 preset。

**自动归类**（取代 client.js 硬编码 7 组 40 件）：

| 规则 | 结果 |
|---|---|
| `mcp__<server>__<tool>` | 按 server 成组 ⇒ 新装 MCP 自动有组可归 |
| `dsh_*` 前缀 | 第三方插件组 |
| `moa_*` 前缀 | MoA 组（已有此机制） |
| 其余 | 宿主原生组 |

⇒ 面板的 7 组硬编码与 KEEP_LIST 33 件硬编码**下移为 host 下发的数据**，
杜绝「client.js 是 host 的影子副本」这一 P1 类缺陷的共同土壤。

### 3.6 exempt 的分级（回应「每个 preset 可彻底避免筛选的白名单」）

用户要的「彻底避免筛选」在机制上有三档，**必须分级，不能一把梭**：

| 档 | 配置 | 效果 | 是否与用户原则冲突 | 本期 |
|---|---|---|---|---|
| 档 1 | `exempt: ["auto"]` | 不受自动发现闸门；**显式 deny 照生效，底线闸照生效** | ❌ 不冲突 | ★ **已裁决采用** |
| 档 2 | `exempt: ["auto","baseline"]` | 连底线闸也豁免 | ⚠️ 需治理授权 | ❌ 本期不实现 |
| 档 3 | 全局豁免 + 不可禁 | —— | ❌ **不做**：与「所有工具都可以在 preset 中禁用」正面冲突 | ❌ 不做 |

⇒ 域 preset 的正确默认是**档 1**：保住能力，同时保留用户随时禁用的能力。

★ **档 2 的「留字段位但不做语义」是硬约束**：若用户配了 `"baseline"`，
必须**显式报「该档未实现」**（面板 + 台账 + warn），**绝不能静默忽略** ——
「配了却不生效」正是本插件自己批判过的静默失败族。
⇒ 实现上：`exempt` 的取值域本期只接受 `["auto"]` 与 `[]`；
出现 `"baseline"` ⇒ **fail-loud**（拒绝保存 + 明确文案），而不是接受后当没看见。

### 3.7 keep-only 严格面（`allow`）为何默认关闭

五路盲审一致：**keep-only 正面清单会裁掉域 preset 自己的工具**，且有生产先例 ——
`role-briefs` v0.7.1「allow 17 ⇒ visible 6」事故（越裁越少，跨会话污染）。

但 keep-only 有唯一独有能力：**新工具默认不可见 ⇒ 漏网在机制上不可能发生**。

⇒ 定位为**可选严格模式**：
- 默认 `allow: null` ⇒ 走 deny 制（迁移零风险、零缩面）；
- 用户显式设 `allow: [...]` ⇒ 该 preset 转入严格模式（面外新工具自动不可见）。

启用严格模式的三条防护：
1. 名单按目标 scope 的 `restrictableNames` 闭包过滤（M11：未知名会整体 throw）；
2. 面必须由 §3.5 的 `natural_face` **自动生成**，用户不手写；
3. 推导面取**未受裁剪的注册态快照**（不能读 post-restrict 视图，否则棘轮收缩、域工具逐轮消失）。

---

## 4. 迁移（零缩面保证）

### 4.1 铁律

1. **旧配置键的读时语义逐字保真**：`baseline_deny` / `preset_allow` / `preset_extra_deny` /
   `main_deny` / `main_preset_allow` / `main_preset_extra_deny` / `capabilities` 一个不改。
   ★ 例外一处（裁决③ 的拆键，**行为仍逐字保真**）：主会话侧对 `preset_allow` 的**回落读**
   从「静默回落」改为「回落 + 显式告警 + 面板一键拆分」，**回落本身不取消**（§10.3），
   ⇒ 未拆分的 preset 主会话行为**与 v0.14.5 逐件一致**。
2. **新增 `preset_rules` 只做增量**：未配置 `preset_rules` 的 preset 行为与 v0.14.5 **逐件一致**。
3. 迁移是**显式、可见、可回滚**；插件启动时**不自动重写**用户 config。
4. **回滚单元独立**：§10 拆键的回滚（删 `main_preset_allow[p]` 即回到回落）
   与 P0/P1 的回滚（删 `origin.json` + `preset_rules`）互不影响。

### 4.2 分期

| 期 | 内容 | 风险 | 独立上线？ |
|---|---|---|---|
| **P0** | 来源感知 pending（§3.4） | 域 preset 面**变大**（illus-deep 60→156） | ★ 与 P1 原子发布（裁决②） |
| **P1** | `preset_rules` 三通道 + 面板推导面 + 自动归类 | 中 | 与 P0 原子发布 |
| **P2** | `missing` / `dropped` 拆分；deny 键去重 | 低 | 可独立 |

### 4.3 golden 基线（迁移闸门）

采集「preset × depth × 观测面」快照并冻结，逐件 diff：

```
golden(preset, depth) = { effective: string[], denied: string[], missing: string[] }
```

- 验收 = **运行面等价**，不是配置快照；
- 差集非空 ⇒ 立即回滚（`origin.json` + `preset_rules` 皆为新增，回滚即删键）；
- 生产 `audit.jsonl` 是跨版本累积（字段随版本演进），**不能直接当基线**。

---

## 5. 不变量与判据（每条须有对应变异通道）

> 纪律：断言的每个输入都必须有对应的**变异通道**；「变异后仍绿」不是结论，是探针坏了。

| # | 不变量 | 变异通道 |
|---|---|---|
| I1 | 域 preset 的 `natural_face` 工具在无显式 deny 时**必须全部可见** | 篡改 pending 作用域 → 转红（防 D1 复现） |
| I2 | 未配 `preset_rules` 的 preset，有效面与 v0.14.5 逐件一致 | 改一处合成规则 → 转红 |
| I3 | 迁移后每个 preset 的有效面 **⊇** 迁移前（除非有显式 deny） | 加一条显式 deny → 转红 |
| I4 | `exempt` **不豁免**显式 `deny` | 去掉 exempt 过滤 → 转红 |
| I5 | 归属表与运行时观测一致（静态推的 server 集合 ⊇ 运行时见到的工具） | 删一条运行时校正 → 转红 |
| I6 | 严格模式下 `allow` 名单按 `restrictableNames` 闭包过滤，且未知名被剔除而非 throw | 注入未知名 → 转红 |
| I7 | 面板分组与归属表一致（同一工具名只有一处归属） | 改 client.js 硬编码 → 转红 |
| I8 | `run_code` 不受任何通道影响 | 把它加进 deny → 转红 |

---

## 6. 现状通道 → 目标通道 对照

| 现状 | 目标 | 变化 |
|---|---|---|
| `baseline_deny`（全局） | 保留 | 底线闸不降级（v0.13.4 P0-B 的 fail-loud 是安全修复） |
| `preset_allow`（子代=豁免 / 主=keep-only，双语义） | 拆键（§10）：子代侧语义**逐字不变**；主会话侧回落读改为**显式告警 + 面板一键拆分** | ★ 裁决③ 本期解决 |
| `preset_extra_deny`（无条件叠加） | 保留 | 语义与豁免权分离 |
| `main_deny` / `main_preset_allow` | 保留 | 主会话侧不变 |
| `capabilities`（组装面） | 保留 | 与 preset 面独立 |
| lock `pending`（全域无差别） | **pending 域收窄为 global**；preset 层新名标 `state:"preset"` 只记账 | ★ P0 |
| client.js `GROUPS` / `KEEP_LIST` 硬编码 | **host 下发**，按 server 自动成组 | ★ P1 |
| 面板快照 `view(undefined)` | 全局层 + **逐 preset 归属面** | ★ P1 |
| —— | **新增** `preset_rules`（deny / exempt / allow） | ★ P1 |
| —— | **新增** `origin.json` 归属表 | ★ P1 |

---

## 7. 边界（明确不做）

- **不改宿主**：全部落在 dtg 插件内，不要求宿主新 API。
- **不改 Loader YAML 方言**：归属表与 `preset_rules` 是 dtg 自己的配置，不进 `cordis.patch.yml`。
- **不合并通道语义**：四条通道各保留独立键与合成规则。
- **不自动改生产配置**：迁移显式、可见、可回滚。
- **不做「全禁只剩 chatbot 也不拦」**：底线闸与显式 deny 永远有效。
- **不做逐轮可变面**：需 `when` 钩子 + 注册生命周期管理，与「不改宿主」冲突 ⇒ 独立议题。

---

## 8. 被否决的部分（保留记录，避免重犯）

| # | 主张 | 否决理由 |
|---|---|---|
| ① | 统一通道求值（一套模组表 + 一个 resolve 吃正/负/深/全局面） | 四类通道语义不同，合并后无落点（五路盲审一致否决） |
| ② | keep-only 正面清单**作为默认** | 会裁掉域 preset 自己的工具（role-briefs v0.7.1「allow 17⇒visible 6」生产先例）⇒ 降为可选严格模式 |
| ③ | `exempt` 一把梭（全豁免且不可禁） | 与用户原则「所有工具都可以在 preset 中禁用」正面冲突 ⇒ 分三档 |
| ④ | 面板靠 `view(presetScopeKey)` 推导面 | registry.generations 是私有 Map，无公开入口（M9）⇒ 改静态声明 + 运行时观测两路 |
| ⑤ | 「面外新工具自动不可见 ⇒ 漏网机制上不可能」 | own 层无条件可见且裁不掉；exempt 本身是设计的合法漏洞；M10/M11 约束 ⇒ 「不可能」不成立，只能「默认不可见 + 可观测」 |
| ⑥ | 迁移期沿用旧 `preset_allow` 名单当 keep-only 面 | 语义替换（豁免制→正面清单）⇒ 子代面静默缩水 ⇒ 须逐 preset 按运行面重推导 |
| ⑦ | 把手工 `tier` 标注为工具属性 | `restrictableNames` 是按 scope 运行时计算的属性，不是工具名的固有属性 |

---

## 9. 用户裁决（2026-11-14 09:34 北京，已定）

| 项 | 裁决 | 影响 |
|---|---|---|
| ① exempt 档位 | **档 1**：只豁免自动闸门（`exempt:["auto"]`） | 显式 `deny` 与底线闸 `baseline_deny` 永远生效；「全禁档」不做，与「所有工具都可禁用」原则不冲突 |
| ② 发布节奏 | **P0 + P1 原子发布** | 一次性上归属表 + `preset_rules` + 面板推导面 + 自动归类，避免「闸门已松、面板没跟上」的中间态 |
| ③ `preset_allow` 双语义 | **本期一起解决** | 拆成两个显式键，见 §10；发布面扩大，与 P0/P1 同一批次但**独立可回滚** |

### 9.1 裁决带来的硬约束

- 档 1 ⇒ §3.6 只需实现 `exempt:["auto"]` 一档；`"baseline"` 档位**不在本期实现**
  （留字段位但不做语义，避免"配了却不生效"的静默陷阱：配了 `"baseline"` 必须报「未实现」而非忽略）。
- 原子发布 ⇒ §3.4 的 `state:"preset"` 记账必须与 P1 面板同批上线，
  否则会出现「审计已松、用户看不到」的治理真空窗口。
- 双语义拆键 ⇒ 见 §10，**独立回滚单元**：§10 的回滚不影响 §3 的 P0/P1。

---

## 10. `preset_allow` 双语义拆分（裁决③ 的设计）

### 10.1 现状的双读路径

| 场景 | 现状读法 | 强度 |
|---|---|---|
| 主会话（depth0） | `pickArr(main_preset_allow[p], preset_allow[p])` —— **回落读** `preset_allow` | keep-only 正面清单 |
| 子代（depth>0） | `effectiveDeny()` 里 `exempt = preset_allow[p]` —— 仅作 baseline/pending 的豁免过滤器 | 黑名单弱 |

⇒ 同一张表两种强度；且主会话的回落读**无告警地改变语义**
（`host.v2.mjs:561` 回落 + `:566-568` 回落时 warn，但 warn 只在回落发生时报，
配置里两键都存在时无法从外部判断主会话实际用的是哪张表）。

### 10.2 拆键设计

| 键 | 场景 | 语义 | 强度 |
|---|---|---|---|
| `preset_allow[p]` | 子代（depth>0） | 对 `baseline_deny ∪ pending` 的**豁免集**（现状语义，逐字保真） | 黑名单弱 |
| `main_preset_allow[p]` | 主会话（depth0） | **keep-only 正面清单**（现状语义，逐字保真） | keep-only 强 |

**唯一的语义变更 = 取消主会话侧对 `preset_allow` 的回落读。**

### 10.3 迁移期兼容（双读→单读的安全过渡）

不能直接砍回落 —— 生产 `preset_allow` 有 6 个键，其中 `cordis-router` 只配了共用键、
没配 `main_preset_allow`（`config.json:283-303`）。直接取消回落 ⇒ router 主会话面**突然变 19 件**。

迁移策略（**显式、可见、可回滚**）：

1. **启动时检测**：对每个 preset 比对「配了 `preset_allow[p]` 但没配 `main_preset_allow[p]`」的集合；
2. **未迁移前的回落仍生效，但升级为显式告警**：
   - 台账记 `allow-fallback` 事件（列名 + preset + 件数）；
   - 面板在对应 preset 上打「⚠ 主会话回落共用键」标记；
3. **面板提供「一键拆分」**：把 `preset_allow[p]` 复制为 `main_preset_allow[p]`，
   并把 `preset_allow[p]` 保留为子代豁免集（**两份并存，语义显式**）；
4. **拆分是幂等动作**：重复点不产生差异；已拆分的 preset 不再回落、不再告警。

### 10.4 拆键后的语义矩阵（迁移完成态）

| preset | 子代面 | 主会话面 | 与 v0.14.5 差异 |
|---|---|---|---|
| 已拆分（`main_preset_allow` 已配） | `baseline∪pending − preset_allow[p] ∪ extra` | keep-only `main_preset_allow[p]` | 无（拆分前后同源同义） |
| 未拆分 | 同上 | keep-only `preset_allow[p]`（回落，告警） | 无（回落即保真） |
| 两者都无 | `baseline∪pending ∪ extra` | `main_deny` 制（无正面清单） | 无 |

⇒ **拆分本身不改变任何一格的行为**，只把「隐式回落」变成「显式两份」。
⇒ 零缩面保证成立：拆分是**可逆**的（删掉 `main_preset_allow[p]` 即回到回落）。

### 10.5 判据（增补）

| # | 不变量 | 变异通道 |
|---|---|---|
| I9 | 拆分动作前后，同一 preset 的主会话有效面**逐件一致** | 篡改拆分实现 → 转红 |
| I10 | 未拆分的 preset 主会话仍回落且**必发告警**（不静默） | 删告警分支 → 转红 |
| I11 | 子代侧 `preset_allow` 语义**不变**（豁免 baseline/pending，不裁面外件） | 改子代合成规则 → 转红 |

---

## 附：与已修 bug 的关系

| 已修根因 | 本方案中的固化点 |
|---|---|
| autoDenyNew 误杀域工具（§1.1 故障 A） | I1 + §3.4 来源感知 pending |
| 域 preset 泄漏 54 件 / router 漏 1 件（§1.1 故障 B） | §3.5 面推导 + §3.3 `deny` 通道 |
| 面板看不见 preset-scoped 件 | §3.5 逐 preset 归属面 |
| client.js 硬编码与 host 无同步 | §3.5 host 下发 + I7 |
| 一次面板批量保存放行 184 个 pending | 面板保存与 pending→seen 转换**解耦为独立动作** + 逐项 diff + 阈值 |
