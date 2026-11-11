# Changelog — dsh-depth-tool-gate

> 最新版本在前。版本号单一权威源 = `package.json`。条目中的 commit hash 是可校验的锚点。

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
