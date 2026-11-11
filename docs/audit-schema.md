# audit-schema — dtg 台账字段字典

台账路径：`$DSH_HOME/logs/depth-tool-gate/audit.jsonl`（append-only，每行一 JSON 事件）。

时间戳统一为 ISO 字符串（UTC）；面板按本地时区显示。

## 事件类型

### 1. 子代理诞生裁剪（gateAgent 常规路径）

| 字段 | 类型 | 含义 |
|---|---|---|
| ts | ISO 字符串 | 事件时刻 |
| agentId | string | 子代 agent id |
| depth | number | delegationDepth（>0=子代） |
| preset | string | header.agentPreset（空串=无） |
| denied | number | 本次裁掉的件数（生效的 deny 数） |
| pendingDenied | string[] | 其中处于 pending 态（待裁决）的工具名 |
| missing | string[] | 名单中运行时未见的名（缺名跳过，不炸） |
| visibleAfter | number | 裁后可见面大小 |
| supplemented | number | 仅在有补挂时出现：补挂的工具件数 |
| supplementedNames | string[] | 仅在有补挂时出现：补挂的工具名 |
| lockNewNames | number | 仅在本次有新名入闸时出现：新增 pending 件数 |
| skipped | string | 跳过原因（no-agent-ctx / no-tools-service / disabled 等，与裁剪计数互斥） |

### 2. 主会话裁剪（gateMain）

| 字段 | 含义 |
|---|---|
| mode | `deny`=按名单裁 / `allow`=正面清单 keep-only |
| denied | deny 模式下=裁掉件数；allow 模式下=清单长度 |
| allowed | 仅 allow 模式：实际生效的件数 |
| missing / visibleAfter / pendingDenied | 同上 |

### 3. preset-denied（preset 访问控制）

| 字段 | 含义 |
|---|---|
| ev="preset-denied" | 类型标识（红行） |
| preset | 被禁 preset id |
| degraded | boolean——true=restrict 失败走了 deny 全量兜底（fail-closed），false=最小回报面成功 |
| restrictApplied | !degraded |

### 4. role-brief-missing（岗位引导缺失）

| 字段 | 含义 |
|---|---|
| ev="role-brief-missing" | 类型标识（红行） |
| brief | 角色名 |
| reason | both-missing（_common+角色文件双缺）/ section-failed（注入异常+error 字段） |
| impact | 影响描述（子代无 role 引导） |

### 5. 治理事件（红行）

`ev` 字段用于把治理事件与常规裁剪记录区分开，面板按 `ev` 标红：

| ev | 含义 |
|---|---|
| config-corrupt | 配置文件读取失败，本次裁剪回退到内置缺省 |
| config-rebuilt-from-panel | 配置文件损坏/缺失时由面板保存重建 |
| lock-corrupt | 闸门文件结构损坏，按锚定模式重建（新名按 pending 拦截） |
| gate-error | 裁剪过程抛异常（fail-open，不阻断会话启动） |

## lock 文件（姊妹数据源）

`$DSH_HOME/profiles/<profile>/depth-tool-gate.lock.json` → `tools[name] = { state, firstSeen, ruledAt? }`。

| state | 谁写的 | 含义 |
|---|---|---|
| pending | 首次见到该名（运行时新名） | 待裁决 → autoDenyNew 时并入裁剪（预先闸门） |
| seen | 裁决为放行，或首次建档时继承存量 | 已裁决/已放行（裁决权威在 config.json，lock 只记历史） |
| forced | 该名在名单里但运行时不可达（如 preset 注册的派单工具） | 面板灰显：裁不到，由派单深度总闸管 |

> 不存在 `denied` 态：裁决为"禁"是写进 `baseline_deny`（配置权威），lock 只把该名标 `seen`。
> 失效条目**永不清理**（保留可见性，重装来源后自动复效）。

## 频率数据

网关 `usageStats()`：`{totalCalls, distinctTools, top:[{name,count}], byPreset:{<preset>:{total,top}}, bySession:[…]}`

- 数据源＝`session/event` 的 `tool/call` 事件，O(1) Map 计数，键上限 4096（超限归并 `__overflow__`）；
- **不落 arguments**（敏感 + 体积）；
- 口径＝调用尝试次数（不分成败）；
- **持久化**：快照写在 `profiles/<profile>/depth-tool-gate.usage.json`，启动时载入、每 500 次调用或每次拉取时落盘 → **重启不清零**；
- `bySession` 为最近 40 个会话（按最近活动倒序），更早的会话不再出现在该列表。
