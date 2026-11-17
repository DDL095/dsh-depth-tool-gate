# adjustment-guide — 工具面调整模式指导（agent 操作向导）

> 面向**要动手调整 dtg 工具面**的 agent。本文是操作向导：想达成 X → 改哪个通道 → 语义陷阱 → 生效时点 → 怎么验 → 安全流程。
> 机制问答见 [agent-faq.md](./agent-faq.md)；字段字典见 [audit-schema.md](./audit-schema.md)；面板逐 Tab 见 [panel-guide.md](./panel-guide.md)；两名单治理模型见 [preset-policy.md](./preset-policy.md)。本文不复述它们，只给选型决策与操作纪律。
> 源码引用一律用**函数名**（不用行号，行号会随版本漂移）：`gateMain` / `resolveMainAllow` / `resolvePresetRules` / `gateChild` / `gateComposed` / `readConfig`，均在 `host.v2.mjs`。

## 0. 动手前必读（三条硬约束）

1. **配置热读、只对之后创建/恢复的 agent 生效**（`readConfig` 每次现读磁盘、无缓存）。运行中会话不追溯 ⇒ 改完**别声称「现有会话立即生效」**（时点详见 §4）。
2. **keep-only 正面清单 = 名单即全部**：未列件全裁（含核心能力），且 `main_deny` **不叠加**。治理忠实执行 + 告知后果，不替用户做「手滑保护」——`PROTECTED_MAIN` 仅警示、照裁（用户裁定：所有工具都应能在 preset 中禁用，全禁只剩 chatbot 也可以）。
3. **改运行位配置前先备份**，用 fail-loud 脚本（brace 定位 + JSON 校验 + 断言其余键全等），禁手敲大块、禁 sed/echo 绕行。运行位 = `~/.dsh/profiles/web/depth-tool-gate.config.json`（不在 git 仓；仓内 `config.default.json` 只是出厂种子）。

## 1. 选型决策树（意图 → 通道）

| 我想… | 改哪个键 | 语义 | 作用层 |
|---|---|---|---|
| 主会话只留某几件能力（定制面） | `main_preset_allow[preset]` | keep-only | depth0 |
| 主会话全局禁某几件（所有 preset） | `main_deny` | deny 叠加 | depth0 |
| 主会话某 preset 额外禁几件 | `main_preset_extra_deny[preset]` | deny 叠加（该 preset 无 keep-only 时） | depth0 |
| 子代全局底线禁 | `baseline_deny` | deny | depth>0 |
| 子代某角色保住域工具（豁免底线） | `preset_allow[preset]` | **豁免**（子代侧） | depth>0 |
| 子代某角色额外禁 | `preset_extra_deny[preset]` | deny 叠加 | depth>0 |
| 某 preset 不许被派单为子代 | `preset_deny[]` | 最小回报面 + roster 隐藏 | 派单链 |
| 某 preset 专属三通道 | `preset_rules[preset]{deny,exempt,allow}` | deny 最强无豁免；allow=严格 keep-only；exempt("auto") 仅子代 | 双层 |
| 临时最小面派单（不改 preset） | `dispatch_composed` 的 `capabilities` | keep-only 组装面 | 子代 |
| 新工具默认拦截子代 | `autoDenyNew` + lock | pending 闸 | depth>0 |

## 2. 四个语义通道（最容易混，别合并）

- **keep-only**（主会话 `main_preset_allow` / `preset_rules.allow` / 组装面）：`restrict({allow})`，名单即全部，`main_deny` 不叠加。
- **豁免**（子代 `preset_allow`）：从 `baseline ∪ pending` 里**豁免**这些名，其余照常裁。⚠ 与主会话侧**同名键语义相反**。
- **deny 叠加**（`main_deny` / `*_extra_deny` / `baseline_deny` / `preset_rules.deny`）：`restrict({deny})`，多层求并。
- **访问控制**（`preset_deny`）：不是裁工具名单，是禁该 preset 作**派单目标**（fail-closed 最小面，绝不保留完整面）+ `list_agent_presets` roster 隐藏；**不影响人开主会话选它**。

⚠ **`preset_allow` 双语义回落**：主会话未配 `main_preset_allow[p]` 时回落共用 `preset_allow[p]`，且回落键在主会话侧按 **keep-only** 生效（台账 `allow-fallback`、面板可见）。消除双语义 → 面板「拆分」把它复制成 `main_preset_allow[p]`。
⚠ **子代侧没有 keep-only**（`preset_allow` 恒为豁免集，`gateChild` 无任何 `restrict({allow})`）。子代要 keep-only 走 `dispatch_composed`，不走 preset 名单。

## 3. 取值与边界（源码事实）

- 主会话正面清单取值链 `resolveMainAllow`：`main_preset_allow[p]`（须为数组）→ 回落 `preset_allow[p]` → 无则 `null`（走 deny 制）。**非法值（非数组）回落**共用键，不静默 fail-open。
- `preset_rules.allow`（严格面）**优先级最高**：配了它则该 preset 正面清单由它定（显式 opt-in 严格模式）；未配才沿用 `main_preset_allow` / 回落。`preset_rules` 非法 ⇒ 该 preset 的 rules **整体不生效**（不部分接受，台账 `preset-rules-invalid`）。
- keep-only 最终面 = `(allow ∩ known) ∖ preset_rules.deny`。`known` = 该会话挂载的可裁工具集（全局行 + preset 行）；`allow` 里不在 `known` 的名记 `missing`（只记账不报错），**面 = applicable，不是 allow 全长**。
- ⚠ **空名单 `[]` 的口径出入**：`resolveMainAllow` 视 `[]` 为显式空正面清单（不回落），但 `gateMain` 在 `applicable=0` 时**不施加 restrict** ⇒ 实际保留原面，**与面板「`[]`=裁全部」提示不一致**（源码事实 + 推断，未单独探针实证）。要「全裁」**别依赖 `[]`**，用显式 deny 全量或 `preset_deny`。

## 4. 生效时点（最容易误判，务必区分新建 vs 现有）

- `readConfig` 现读无缓存 ⇒ 写盘后**新建 agent** 立即按新名单 gate。
- `gateMain` 触发点：`agent/created`（新建 / resume）+ `agent-preset/selected`（v0.16.14 重裁监听，仅 depth0、仅**首轮前**手选；先 dispose 旧 scope 再重裁——`restrict` 是**追加/交集**语义，不 dispose 旧 deny 永不解除）。
- registry **首轮后锁定 preset**（`agent-preset/locked`）⇒ 已过首轮的会话即使重选同 preset 也不触发重裁。
- **重启后所有会话变冷**；self-repair-guard 只自动 resume **有 armed goal / durable 白名单**的冷会话；其余冷会话待用户在 GUI **打开/续聊**才 resume → 重裁。
- ⇒ 改名单后：**新建会话即生效**；现有锁定会话需**重启 resume** 或**用户重新打开**才切新面。验证某冷会话新面，须等它 resume 后查台账（§6），别凭配置落盘就断言它会话已生效。

## 5. 安全调整流程（改运行位配置）

1. **备份**当前 config 到 `._backup/<tag>/`（gitignore，不入仓）。
2. **fail-loud 脚本**：读 → 改目标键 → 断言（目标键长度 / 关键件在 / 应裁件不在 / 无重复 / 全部在 lock.tools 已知）→ 断言**其余键全等**（`preset_allow` / `preset_deny` / `main_deny` / `baseline_deny` / `capabilities` / 其它 `main_preset_allow` 键）→ JSON 合法 → 写。
   ⚠ 定位 `main_preset_allow` 段用 **brace-matching**（从 `"main_preset_allow"` 后的 `{` 计数到闭合）；**裸字符串锚会撞**——`aigen-deep` / `cordis-router` 等同名键在 `preset_allow` 里也有。
3. **复核磁盘态**：重读 counts + 关键件齐全性。
4. **验证生效**：新建会话或重启后查 `audit.jsonl` 该会话 `主会话裁剪` / `preset-regate` 行（mode / allowed / visibleAfter）；或会话内 `explain_gate` 自证。
5. **纯 config 改动不需重启**（新会话即生效）；**host 代码改动**才需重启 + 沙箱七步（见 `internal/docs/DEV-SOP.md` / 全局 AGENTS.md「DSH 本体修改·沙箱强制」）。

## 6. 验证与对账

- `explain_gate`（会话内只读）：可见数 + 逐件被裁归因（无对应规则 ⇒ `dtg-unknown`）。
- `audit.jsonl`（`~/.dsh/logs/depth-tool-gate/`）：gate 事件 mode / denied / allowed / missing / visibleAfter / `preset-regate` / `allow-fallback` / `preset-denied`。
- `scripts/canary-v015.mjs`：生产健康（C6 版本 / C3 无 DEGRADED / C4-C5 金基线对账）。⚠ **改 config ⇒ 指纹变 ⇒ C4/C5 跳过不判回归**（预期，非红）；要恢复逐组对账重采基线 `scripts/probe-golden-baseline.mjs --since <ISO>`。
- 面板「生效面预览」Tab（v0.16.12）：切 preset 看主/子最终面 √/×（host `previewFace` 只读仿真，复用执法函数）。

## 7. 常见误操作与教训

- **面板误改名单**（实例：aigen-deep 102→61，误删 understand_image/paddleocr_vl/present）：先**三方对比**（当前 vs 备份 vs 原始写入脚本）定位实际改动，别凭记忆归因。
- **「某 preset 被误改」类报告**（实例：报 standard 被误改，实际盘上 standard 专属键从未变、改的是 aigen）：先查备份时间线 + 专属键证据；**无证据不擅自改**，如实报告并问清意图。
- **keep-only 名单要含验证/交付件**（read_image / understand_image / paddleocr_vl / present），别只留生图件——否则生图通但验证链断。
- **孤儿工具单独留无用**：moa_hunt_2b（无 hunt/2a 前置）、skill_supply_update_check（无 update/pull 配套）⇒ 裁。
- **preset 设计口径**：aigen-deep 是派单域面，人开绘画会话用 paint-deep / gallery-deep；给主会话分区配 `main_preset_allow` 时别漏（漏了 ⇒ 走 `main_deny` 反被裁掉域工具）。

## 权威数据源

- 配置 `~/.dsh/profiles/web/depth-tool-gate.config.json`（热读）；lock `depth-tool-gate.lock.json`（四态 pending/seen/forced/preset）；台账 `~/.dsh/logs/depth-tool-gate/audit.jsonl`。
- 源码 `host.v2.mjs`：`gateMain` / `resolveMainAllow` / `resolvePresetRules` / `gateChild` / `gateComposed` / `readConfig` / `agent-preset/selected` 监听。
- 发布链 `internal/docs/release-guide.md`；开发 SOP `internal/docs/DEV-SOP.md`。
