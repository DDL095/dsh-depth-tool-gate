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
