# troubleshooting — 故障排查（静默降级族优先）

> v2 通则：**静默降级=最危险**（插件活/面板活/裁剪活，但某层悄悄失效）——同族缺陷：§7.5 role-brief 缺失（v0.8.2 已台账化）/ kill switch 不 kill / 豁免静默失效。排查顺序永远=先查台账 `audit.jsonl` 的新事件类型。

## 症状速查

| 症状 | 首查 | 常见根因 |
|---|---|---|
| 子代"变笨"（无引导） | 台账 `role-brief-missing` | agents-briefs/ 缺文件（发布包 files 漏装/被删）；npm 装的旧版无 v0.8.2 修复 |
| 子代缺文件能力 | 面板 Tab7 闸门 pending | preset 行集工具整批首见被 autoDenyNew 拦（已知会整批发生）——批量放行或关 autoDenyNew |
| 某工具子代调不到 | `explain_gate` | 归因直接给答案（main_deny/baseline/extra/allow 外/pending） |
| 面板「未知 op」 | client callGate 分支 | host/client 版本不齐（host 新 client 旧）——刷新页面重载 client 半 |
| 频率 Tab 恒 0 | 面板 Tab5 拉取 | 快照已落盘，**重启不清零**；恒 0 且刚有调用=双实例 pick() 选中未采集实例（已知限制） |
| 子代面比预期还大 | 台账 preset-denied 的 degraded | preset_deny 被触发且走了 fail-closed 兜底（degraded=true 是正常防御）；若无台账记录但面大=gate 整个 skipped（查 skipped 原因） |
| 裁剪对已开会话不生效 | — | by-design：热读只对**之后创建或恢复**的 agent 生效 |
| preset_deny 后子代仍 spawn | 台账 | by-design（v2.1 已知限制）：拦截在创建后非入口前；资源仍被占——高价值场景配 maxDepth/并发闸 |
| 主会话工具面意外变窄 | 宿主日志"回落共用键"告警 | 该 preset 未配 `main_preset_allow`，回落了共用的 `preset_allow[preset]`（主会话侧按 keep-only 生效，`main_deny` 不叠加） |

## 升级/重装注意
- lock 的 seen 名单保留（失效条目不清理，重装即复效）；
- config 与 config.default.json 漂移：config 是运行权威，default 是蓝本——面板保存走 spread 保真（未透传键保留）；
- 插件行集变更（preset 加插件行）→ 新工具整批 pending，须主动裁决。

## 沙箱/profile 陷阱
- `DSH_HOME` 不一致的路径分裂已修（v0.8.2 role-briefs 对齐 env）——旧版在沙箱 profile 会读错生产 config；
- 双实例（生产+沙箱 3081 同跑）时 gate 数据面各独立，面板连的是生产实例。
