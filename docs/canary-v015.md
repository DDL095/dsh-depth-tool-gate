# v0.15.0 上线 canary 结论

> 状态：**上线确认，故障 A 已修**。本文只记当前态与证据，演变史进 git commit。
> 判据工具：`scripts/canary-v015.mjs`、`scripts/probe-p0-prodlock.mjs`、
> `scripts/probe-golden-baseline.mjs`。

## 一、结论

| 判据 | 结果 |
|---|---|
| canary 脚本（`node scripts/canary-v015.mjs`） | **7 passed / 0 failed / 0 skipped**，退出码 0 |
| 生产包版本 | 0.15.0 |
| 3080 进程 | 起于 2026-11-14 17:37:11 北京（改动落盘之后 ⇒ 已加载新码） |
| 治理降级 | 无 `DEGRADED` 标记（peer 就绪） |
| 缩面回归 | **0 组**（逐组对账） |
| golden 配置指纹 | 基线 `bf54712e` = 现值 ⇒ 对账有效 |

## 二、故障 A 的三层证据

### ① 数据级 —— 生产 lock 分布与预期逐项一致

| 状态 | 迁移前 | 预期 | 实测 |
|---|---|---|---|
| seen | 127 | 127 | **127** ✓ |
| pending | 280 | 0 | **0** ✓ |
| forced | 2 | 2 | **2** ✓ |
| preset | 0 | 280 | **280** ✓ |

- **域工具 278/278 全部改判 preset**（illustrator 96 / word 120 / excel 59 / ppt 3）
  ⇒ 不再被自动发现闸门误杀；
- **全局层 62 件（一律 `seen`）与 `subagent`/`subagent_fork`（`forced`）一字未动**
  ⇒ 自动闸门的「拦新不拦旧」原意不受影响。

### ② 行为级 —— 真会话自报（用的就是生产宿主）

| preset | 迁移前面 | 迁移后面 | 域工具可见性 |
|---|---|---|---|
| illus-deep | 60 | **158** | illustrator **67 件全部可见** + illustrator-vec **29 件全部可见**（此前 0 件） |
| word-deep | 174 | **176** | word 120 件可见；**excel/ppt 零泄漏**（域隔离正确） |

台账逐字坐实：`{"preset":"illus-deep","denied":56,"pendingDenied":0,"visibleAfter":158}`。

### ③ 归属级 —— `origin.json` 与子代理自报逐件吻合

| preset | 归属构成 |
|---|---|
| illus-deep | illustrator 67 + illustrator-vec 29 + 原生 33 = **129** |
| word-deep | word 120 + 原生 33 = **153** |
| cordis-sub | 原生 25 |

⇒ 归属表的来源判定（`knownNames ∖ 全局层`）与运行时实测一致。

## 三、零缩面 —— 其余 preset 面一字不变

| preset × depth | 迁移前 | 迁移后 |
|---|---|---|
| cordis-deep@0 | 98 | 98 |
| cordis-sub@1 | 54 | 54 |
| excel-deep@1 | 113 | 113 |
| ppt-deep@1 | 57 | 57 |
| aigen-deep@1 | 60 | 60 |
| moa-referee@1 | 31 | 31 |
| word-deep@1 | 174 | **176** |
| illus-deep@1 | 60 | **158** |

只有域 preset 变大（= 域工具恢复），其余**一字未动** ⇒ 迁移零副作用。

## 四、两份 golden 基线的角色

| 目录 | 角色 | 覆盖面 |
|---|---|---|
| `2026-11-14T02-29-55-995Z` | **v0.15.0 迁移的闸门基准**（迁移前采集） | 8 组 |
| `2026-11-14T09-45-35-161Z` | v0.15.0 生效态快照（下一轮迁移的起点参照） | 3 组 |

⇒ 新基线覆盖面窄（仅重启后开过会话的 preset），**不可取代**旧基线作闸门基准。

## 五、已知边界（如实记录）

- `origin.json` 的 `servers` 字段为空是**设计如此**：server 名在 `snapshot()` 响应里
  实时派生（`scanPresetServers()`），不落盘（落盘的只有运行时观测到的 `tools`）。
- `explain_gate` 在域会话里不可见（它在 `baseline_deny` 里 ⇒ 子代被裁）⇒ 域会话的
  逐件诊断只能靠子代理自报；主会话可用。

---

## 六、`explain_gate` 是什么

**一句话**：它是 dtg 的**只读诊断工具** —— 回答「我（这个 agent）现在看得见哪些工具、
看不见的那些是被哪条规则裁掉的」。

| 项 | 值 |
|---|---|
| 状态 | **只读**，不改任何状态（不写 config、不动 lock、不改工具面） |
| 调用方 | 派单失败诊断 / 子代理自检 / 面板口径对账 |
| 输入 | 无参数（自动取**调用者自己**的 agent 上下文） |
| 输出 | `{visibleCount, restrictableCount, deniedCount, denied:[{name, reason}]}` |
| 可见性 | **主会话可见；域会话不可见**（它在 `baseline_deny` 里 ⇒ 被子代闸门裁掉） |

**`reason` 的归因链**（按优先级，命中即止）：

| reason | 含义 |
|---|---|
| `preset_rules.deny(<preset>)(用户显式禁用)` | 用户在该 preset 的专属配置里显式禁的 |
| `main_deny(主会话显式名单)` | 主会话全局禁用名单 |
| `main_preset_extra_deny(<preset>)(主会话按角色禁用)` | 主会话按角色的额外禁用 |
| `baseline_deny(子代基线)` | 子代全局底线闸 |
| `preset_extra_deny(<preset>)` | 该 preset 的额外加裁 |
| `preset_allow 正面清单外(<preset>)` | 不在该 preset 的正面清单里 |
| `lock pending(新工具待裁决)` | 自动发现的新工具，等你裁决 |
| `lock preset 自带工具(<preset>)(不在本会话的挂载范围)` | 该工具由**别的** preset 声明，本会话没挂载 |
| `dtg-unknown` | 以上都没命中（= 报告缺失，视为缺陷信号） |

**为什么要它**：工具面治理最怕「工具不见了但说不出为什么」。`explain_gate` 把
「被裁 + 为什么裁」一起给出 ⇒ 派单失败时能立刻定位是哪条规则、哪个 preset。

## 七、把 `explain_gate` 挪出 `baseline_deny` 的效果

**现状**：`explain_gate` 在 `baseline_deny` 里 ⇒ **子代（含所有域会话）都看不到它**
⇒ 域会话的子代理无法自查工具面（本次验证 illus-deep 时就是靠子代理**口头自报**
工具清单，才确认了 67 件 illustrator 恢复可见）。

**挪出的效果**（把它从底线闸名单里移走）：

| | 现状 | 挪出后 |
|---|---|---|
| 主会话 | 可用 | 可用（不变） |
| 域会话（illus-deep 等） | **不可见** | **可见** ⇒ 子代理能自查「我有多少工具、少了哪些、为什么少」 |
| 工具面税 | 0（它本来就被裁） | +1 件（每个域会话多一个只读诊断工具） |
| 安全影响 | 无 | **无** —— 它是只读的：不能改 config、不能改 lock、不能改任何 agent 的工具面 |
| 对 baseline 底线闸的意义 | 它不属于「高危执行类」 | 它本来就不该在底线闸里 —— 底线闸的定位是**拦住能动手的工具**，诊断工具不在此列 |

**代价**：每个域会话的提示词/工具清单多 1 个工具名（token 成本极小）。

**我的建议**：**值得挪**。理由是它把「域会话无法自查」这个能力缺口补上了，
而代价只是 1 件只读工具的 token。这属于**用户裁决**（治理边界是你的，不是我的）。

---

## 八、附:本批遗留与建议

| 项 | 性质 | 状态 |
|---|---|---|
| `explain_gate` 不在域会话可见 | 能力缺口 | 挪出 `baseline_deny`（见 §七）—— **属用户裁决, 待决** |
| `explain_gate` 归因链补 `preset` 态 | 已修 | **v0.15.1** 补（域工具不在本会话挂载范围）；可达性与优先级由 `scripts/probe-explain-preset-attr.mjs` 坐实（8 项 + 变异通道） |
| `config.default.json` 补 `preset_rules` 样板 | 已修 | **v0.15.1** 补（新用户照着填） |
| 档 2 豁免（连底线闸一起豁免） | 治理授权 | 按裁决①**本期不做**；若要，需用户明示授权 |
| `preset_allow` 子代侧语义残留双义 | 已知边界 | 子代侧语义**逐字保真**（豁免制），不影响正确性；若要彻底拆需独立立项 |
| `allow` 严格面（keep-only） | 默认关闭 | 保持关闭（启用会裁掉域 preset 自己的工具） |

