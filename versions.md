# Changelog — dsh-depth-tool-gate

> 最新版本在前。版本号单一权威源 = `package.json`。条目中的 commit hash 是可校验的锚点。

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
- **名称定案**: 保留包名 depth-tool-gate, 面板中文标题扩为「子代理工具面·闸门与组装台」;
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
