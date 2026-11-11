/* dsh-depth-tool-gate — 工具面负面清单闸(host 半)
 *
 * ── 目的 ─────────────────────────────────────────────────────────────────
 * 子代理默认继承宿主的全局工具全集与全部全局引导。一个只需要"读三个文件"的
 * 子代理, 照样要每轮携带图像生成、插件管理、系统重启、定时任务等工具的 schema,
 * 以及与其职责无关甚至矛盾的引导段落 —— 既是 token 成本, 也是误用面与注意力稀释。
 *
 * 本插件在**宿主层**强制裁剪, 而非靠提示词约定:
 *   tools.restrict({deny|allow}) 是宿主的 per-agent 作用域裁剪 API, 覆盖全局行,
 *   对未知工具名 fail-loud, 且限制可叠加。宿主自 0.2.1 起不再接受行级 toolFilter.deny,
 *   preset 行集又是叠加层(挡不住全局行), 因此治理必须落在 tools.restrict() 上。
 *   本插件是它的薄封装: 监听 agent/created → 按名单算出生效集合 → 逐 agent 裁剪。
 *
 * ── 裁剪面(五张名单, 作用域各异) ─────────────────────────────────────────
 *   baseline_deny          所有子代理(depth>0)的底线
 *   preset_extra_deny[p]   按角色的加裁
 *   preset_allow[p]        按角色的正面清单(名单即意图, 命中即豁免 baseline)
 *   main_deny              主会话(depth 0)的显式禁用面
 *   main_preset_extra_deny[p] / main_preset_allow[p]
 *                          主会话按角色: 与子代侧分键配置, 未配置时回落共用键
 *
 * ── 新工具闸门(lock) ────────────────────────────────────────────────────
 *   运行时首见的工具名记为 pending; autoDenyNew(默认开)时 pending 件并入裁剪,
 *   人工裁决(rule)后才放行 —— 宿主升级或新装插件不会悄悄扩大子代理面。
 *   三态: pending(待裁决) / seen(已裁决) / forced(preset 注册, restrict 不可达)。
 *   失效条目永不清理: 来源停用后再装回即自动复效。
 *
 * ── 主会话裁剪的差异语义 ────────────────────────────────────────────────
 *   主会话只裁显式名单, 不进 lock/pending 体系(autoDenyNew 不波及主会话) ——
 *   主会话面本就是全局面, 新工具默认应当可见。PROTECTED_MAIN 保护集兜底,
 *   误裁核心工具会被剔除并告警, 防止手滑裁瘫主会话。
 *
 * ── 动态工具面组装(dispatch_composed) ───────────────────────────────────
 *   wrapper 工具 spawn 子代理 + 预挂 childId 通道 + agent/created 内的
 *   restrict({allow})(keep-only: 未来新增的全局工具自动不可见)。
 *   子代显式绑最小空壳 preset(dtg-shell): 不绑则 spawn 不继承父 preset 行集,
 *   且 agent 自身 scope 的注册名不在可裁名集合内, 全局面无法精确裁剪。
 *   能力标签表 = config.capabilities(缺省 DEFAULT_CAPABILITIES), 热读。
 *
 * ── 已知约束 ─────────────────────────────────────────────────────────────
 *   ① restrict 拒 preset-scoped 名(如 subagent): 见 FORCED_NAMES; 名单与运行时
 *      可见集求交, 缺名记 warn 不炸(防宿主改名后子面全灭)。
 *   ② agent/created 监听必须同步快速返回(串行事件, 慢监听=会话创建卡死)
 *      —— 裁剪与 lock 同步都是纯内存 + 偶发小文件写。
 *   ③ 配置热读, 但只对**之后创建**的 agent 生效; 运行中的会话不变。
 *   ④ 数据面走 TypertRemoteService 网关(信封剥离 + 闭包兜底)。
 *
 * 配置: <profile 目录>/depth-tool-gate.config.json
 *   { baseline_deny: [...], preset_allow: {...}, preset_extra_deny: {...},
 *     main_deny: [...], main_preset_allow: {...}, main_preset_extra_deny: {...},
 *     preset_deny: [...], capabilities: {...}, autoDenyNew: true, enabled: true }
 * 闸门: <profile 目录>/depth-tool-gate.lock.json(本插件维护, 勿手编)
 * 快照: <profile 目录>/depth-tool-gate.usage.json
 * 台账: ~/.dsh/logs/depth-tool-gate/audit.jsonl (append-only)
 *   <profile 目录> = 宿主 profileContext.dir, 缺省回落 ~/.dsh/profiles/web
 *
 * 宿主升级必查: tools.restrict()/view() 与 createScope() 的语义存续, 以及
 *   agentPresets 枚举返回形状。宿主侧语义变更时, 见 docs/ 下的升级复核清单。
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, renameSync, statSync, readdirSync, unlinkSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
/* [v0.14.0 P0 根治] 原静态裸名 import 两个宿主 peer:
 *     import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
 *     import { createScope } from "@deepseek-ai/dsh-scope";
 * 静态 import 在**模块加载期**解析, 锚点是**语句所在文件自身位置**(Node ESM 语义),
 * 不是 loader 的 baseUrl ⇒ 装到 ~/.dsh/profiles/web/node_modules/ 的发布态上溯链里
 * 没有宿主包 ⇒ ERR_MODULE_NOT_FOUND ⇒ **整个插件加载失败**(npm 用户照 README 第一条
 * 命令装完即炸); 开发态(源仓自带 node_modules junction)恰好能跑 ⇒ 缺陷被本机掩盖。
 *
 * 改用 peer-resolver.mjs 动态解析(createRequire + profileContext.installAnchor 锚点):
 * 解析到的与宿主 dsh-tools 侧是**同一物理文件** ⇒ require(esm) 与宿主 ESM import
 * 共享同一模块实例 ⇒ dsh-scope 的 kScope(Symbol("dsh.scope"), 非注册 Symbol)单例
 * ⇒ 不产生双实例(双实例会让宿主 tools.restrict() 抛 "requires a scoped context",
 * 把"加载失败"升级成"裁剪静默失效", 更糟)。详见 peer-resolver.mjs 顶部说明。 */
import { resolvePeers, getPeers, peerError, anchorKey } from "./peer-resolver.mjs";
/* 回执渲染与测试共用一份真代码(见 composed-render.mjs 顶部说明: 旧形态的"同构副本"
 * 会漂移 —— 改 host 不改副本, 测试全绿而真 render 已坏)。 */
import { renderComposed } from "./composed-render.mjs";

/* tools = 全局单例服务(在插件根取一次): restrict/view 在**服务**上, 作用域由
 * createScope(agent.ctx, agent) 构造; agent.ctx.get("tools") 可能撞 scope 隔离
 * 返回 undefined → 永久 no-op, 故不采用。 */
let TOOLS = null;
let ROOT_CTX = null;            /* apply 时留存: snapshot 临时 scope 与 agentPresets 读取用 */
/* [v0.14.0 P0 修] peer 就绪状态**按锚点键派生**, 不用单一模块级 bool。
 * 原因(盲审指出 + A18 实测坐实): 单一 bool 在同一模块实例下第二次 apply 会残留
 * 前一次的 true ⇒ 第二个 profile / 降级用例复用首次成功结果 ⇒ 降级路径根本
 * 走不到(实测: 降级日志为零)。PEER_KEY = 本次 apply 用的锚点键。 */
let PEER_KEY = null;
const peersReady = () => !!PEER_KEY && !!getPeers(PEER_KEY);
/* [v0.14.0 P0] createScope 同签名 wrapper: peer 解析后转发到宿主那一份。
 * 6 处调用点零改动 —— 签名与返回形状不变, 只换实现来源。 */
function createScope(ctx, key, options) {
	const peers = PEER_KEY ? getPeers(PEER_KEY) : null;
	if (!peers) throw new Error("dsh-depth-tool-gate: 宿主 peer 未就绪(降级模式), 无法构造作用域");
	return peers.scope.createScope(ctx, key, options);
}
/* [v0.9] usageStats 内存态: tool/call 频率(per-tool 总量 + per-preset 分桶) */
const USAGE_TOTAL = new Map();
const USAGE_BY_PRESET = new Map();
	const USAGE_BY_SESSION = new Map(); /* [v0.11] sessionId → {id,preset,total,first,last,tools:Map}; cap 500 淘汰最旧 */
const SCOPES = new Map();       /* agentId → createScope 句柄(restriction 随 scope fiber 存活, agent/disposed 回收) */

export const name = "dsh-depth-tool-gate";
/* inject 必须声明 "tools": ctx.tools.register 的属性访问路径强制要求注入该服务
 * (缺失时报 "cannot get property tools without inject"); ctx.get("tools") 是服务
 * 定位器可绕, 但工具注册走不了。tools 为 boot 早期核心服务, 注入无时序风险。 */
export const inject = ["tools"];

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
/* 配置/闸门/频率快照目录: 按**当前 profile** 解析(宿主在 profileContext.dir 给出),
 * 缺省回落 profiles/web —— 既保持既有文件位置不变, 又避免 desktop/headless/test
 * 等 profile 误读写 web profile 的策略与台账(跨 profile 污染)。
 * 模块加载期 apply() 尚未运行, 故取路径走惰性解析函数而非模块级常量。 */
let PROFILE_DIR = null;
function profileDir() {
	if (PROFILE_DIR) return PROFILE_DIR;
	let d = null;
	try { const pc = ROOT_CTX?.get?.("profileContext"); if (pc && typeof pc.dir === "string" && pc.dir) d = pc.dir; } catch { /* 服务未就绪 */ }
	if (d) PROFILE_DIR = d; /* 只缓存真实目录, 回落值每次重算 */
	return d ?? join(DSH_HOME, "profiles", "web");
}
const CFG_PATH = () => join(profileDir(), "depth-tool-gate.config.json");
const LOCK_PATH = () => join(profileDir(), "depth-tool-gate.lock.json");
const AUDIT_DIR = join(DSH_HOME, "logs", "depth-tool-gate");
	const USAGE_PATH = () => join(profileDir(), "depth-tool-gate.usage.json"); /* 频率落盘快照(重启不清零) */
	let USAGE_DIRTY = 0; /* 自上次落盘的调用计数(≥500 或面板拉取时 flush) */
	function loadUsageSnapshot() {
		try {
			if (!existsSync(USAGE_PATH())) return;
			const d = JSON.parse(readFileSync(USAGE_PATH(), "utf8"));
			/* 落盘文件=不可信输入面: version 门 + 逐条类型校验(计数 Number 化, 会话条目要求 id:string)
			 * + 载入即截断回 cap(防「删一插一净零」永不收缩); 坏条目丢弃并计数告警, 绝不进内存 */
			if (!d || typeof d !== "object" || Array.isArray(d) || d.version !== 1) { warn("usage 快照 version 不识别(整体弃用): " + String(d?.version)); return; }
			let bad = 0;
			const num = (v) => { const c = Number(v); return (Number.isFinite(c) && c >= 0) ? c : null; };
			for (const [k, v] of Object.entries(d.total || {})) { const c = num(v); if (c !== null) USAGE_TOTAL.set(k, c); else bad++; }
			for (const [p, m] of Object.entries(d.byPreset || {})) {
				if (!m || typeof m !== "object" || Array.isArray(m)) { bad++; continue; }
				const mm = new Map();
				for (const [t, c] of Object.entries(m)) { const cc = num(c); if (cc !== null) mm.set(t, cc); else bad++; }
				if (mm.size) USAGE_BY_PRESET.set(p, mm);
			}
			for (const [sid, v] of Object.entries(d.bySession || {})) {
				if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.id !== "string" || !v.id) { bad++; continue; }
				const tools = new Map();
				for (const [t, c] of Object.entries(v.tools || {})) { const cc = num(c); if (cc !== null) tools.set(t, cc); else bad++; }
				USAGE_BY_SESSION.set(sid, { id: v.id, preset: typeof v.preset === "string" ? v.preset : "?", total: num(v.total) ?? [...tools.values()].reduce((a, b) => a + b, 0), first: String(v.first || ""), last: String(v.last || ""), tools });
			}
			while (USAGE_BY_SESSION.size > 500) { /* 载入即截断到 cap */
				let ok = null, okLast;
				for (const [k, v] of USAGE_BY_SESSION) if (okLast === undefined || (v.last || "") < okLast) { ok = k; okLast = v.last || ""; }
				if (ok === null) break;
				USAGE_BY_SESSION.delete(ok);
			}
			log(`usage 快照载入: 工具 ${USAGE_TOTAL.size} · 角色 ${USAGE_BY_PRESET.size} · 会话 ${USAGE_BY_SESSION.size}${bad ? ` · 坏条目丢弃 ${bad}` : ""}`);
		} catch (e) { warn("usage 快照载入失败(从零计): " + String((e && e.message) || e)); }
	}
	function flushUsage() {
		try {
			const d = { version: 1, updatedAt: new Date().toISOString(),
				total: Object.fromEntries(USAGE_TOTAL),
				byPreset: Object.fromEntries([...USAGE_BY_PRESET].map(([k, m]) => [k, Object.fromEntries(m)])),
				bySession: Object.fromEntries([...USAGE_BY_SESSION].map(([k, v]) => [k, { ...v, tools: Object.fromEntries(v.tools) }])),
				};
			mkdirSync(profileDir(), { recursive: true });
			atomicWrite(USAGE_PATH(), JSON.stringify(d));
		} catch (e) { warn("usage 落盘失败(下个 500 调用周期重试): " + String((e && e.message) || e)); }
		USAGE_DIRTY = 0; /* 失败也清标: 防同步热路径每调用重试风暴; 数据在内存 Map 不丢 */
	}
const AUDIT_PATH = join(AUDIT_DIR, "audit.jsonl");
/* [v0.14.0 P2] 台账归档目录与轮转阈值。
 * 归档 ≠ 删除: 当前档超过 AUDIT_MAX_BYTES 即轮转为 archive/audit-<ts>.jsonl,
 * 历史**一条不丢**, 面板 recent() 跨档读取(当前档 + 归档档, 按时间倒序)。
 * 阈值取 8MB: 现网 870KB/天级增长量级下 ≈ 数月才触发一次, 但能兜住长期运行
 * 与"高频派单"两种极端。 */
const AUDIT_ARCHIVE_DIR = join(AUDIT_DIR, "archive");
const AUDIT_MAX_BYTES = 8 * 1024 * 1024;
const AUDIT_MAX_ARCHIVES = 24; /* 归档档数上限(超出的最老档才清; 默认永不触发) */
/* [v0.14.0 P2] 写计数(轮转检查节流用); 必须是显式声明 —— ESM 里未声明变量
 * 读取即 ReferenceError, 不能靠 `X || 0` 兜。 */
let AUDIT_WRITES = 0;
const NAME = "dsh-depth-tool-gate";

/* preset-scoped 组名: 由 preset 内 tool-subagent 行注册, 不在全局 restrictableNames
 * 内, tools.restrict() 够不着(0.2.1/0.2.2 实测)。深度由 maxDepth=12 总闸管。 */
const FORCED_NAMES = new Set(["subagent", "subagent_fork"]);

/* [v0.4.2] dispatch_composed: reserved childId → allow 名单中转仓。
 * TTL = spawn→agent/created 正常时延(<5s)加裕量; 残留(spawn 失败/abort)由清扫回收。
 *
 * [v0.13.2] 预挂**改为持久**: 认领后不再删除, 由 TTL 清扫兜底。
 *   起因(台账实测坐实): 子代跑完后再用 send_message 续派 → 宿主 coldResume
 *   冷恢复 → 重新物化 agent → agent/created 再次触发。但预挂在首次创建时
 *   已被消费删除 → 认领失败 → 落回普通 deny 名单裁剪 → **工具面完全变了**
 *   (实测同一 agentId 的面从 109 掉到 5) → KV 前缀失效、工具用不了。
 *   持久后: 续派/冷恢复命中同一份 allow 名单 → 面稳定不变。
 *   清理: capSweeper 的 TTL 清扫(不在认领点删)。
 *   defs: 派发时快照的主会话定义(补挂源), 使子代理面与主会话实时面解耦 ——
 *   否则主会话面一变(改 main_deny / pending 进件 / 新工具出现), 补挂就补不上,
 *   子代理面跟着漂移(实测同标签 literature-lead 的面在 23 与 25 之间跳)。 */
const PENDING_CAPS = new Map();  /* childId → {allow:Set<string>, label, expires, defs?:Map, used:number} */
const CAP_TTL_MS = 60_000;

/* [v0.4.2] 能力标签表缺省(config.capabilities 存在则整体覆盖): 标签→allow 名单。
 * allow=keep-only 语义: 面外一切(含未来新全局工具)不可见。 */
const DEFAULT_CAPABILITIES = {
	literature: [
		"mcp__research-tools__smart_search", "mcp__research-tools__search_broad", "mcp__research-tools__search_depth",
		"mcp__research-tools__search_academic_only", "mcp__research-tools__openalex_search", "mcp__research-tools__cited_by",
		"mcp__research-tools__doi_metadata", "mcp__research-tools__extract_content", "mcp__research-tools__search_scholar",
		"mcp__research-tools__search_validate", "mcp__research-tools__get_recent_result", "mcp__research-tools__list_recent_results",
		"mcp__zotero__check_local", "mcp__zotero__search", "mcp__zotero__search_notes",
		"web_search", "web_fetch", "read", "glob", "grep", "working_directory", "todo_write",
	],
	reader: [
		"web_fetch", "web_search", "read", "read_image", "glob", "grep", "working_directory", "todo_write",
	],
	/* [v0.4.7] lead 系标签: 面内含 dispatch_composed —— 该子代可再派一级动态组装孙代
	 * (spawn 侧 maxDepth 条件放行 +1, 总闸 maxDepth=12 仍管辖); 无 lead 标签的面
	 * 级联仍被钉死在自身深度。 */
	"reader-lead": [
		"web_fetch", "web_search", "read", "read_image", "glob", "grep", "working_directory", "todo_write",
		"dispatch_composed",
	],
	/* [v0.5] literature-lead: 文献检索面+派单权——子代 foreman 化(自带带队再派一级)。 */
	"literature-lead": [
		"mcp__research-tools__smart_search", "mcp__research-tools__search_broad", "mcp__research-tools__search_depth",
		"mcp__research-tools__search_academic_only", "mcp__research-tools__openalex_search", "mcp__research-tools__cited_by",
		"mcp__research-tools__doi_metadata", "mcp__research-tools__extract_content", "mcp__research-tools__search_scholar",
		"mcp__research-tools__search_validate", "mcp__research-tools__get_recent_result", "mcp__research-tools__list_recent_results",
		"mcp__zotero__check_local", "mcp__zotero__search", "mcp__zotero__search_notes",
		"web_search", "web_fetch", "read", "glob", "grep", "working_directory", "todo_write",
		"dispatch_composed",
	],
	ocr: [
		"mcp__paddleocr__paddleocr_vl", "mcp__minimax-plan__understand_image",
		"read_image", "read", "write", "glob", "grep", "working_directory", "todo_write",
	],
};

/* [v0.4] 主会话保护集: main_deny 名单中若出现这些名, 剔除并 warn——主会话核心
 * 作业/交互/编排能力, 裁掉即瘫痪(防手滑)。保护集外皆可裁(含 MCP)。 */
const PROTECTED_MAIN = new Set([
	"ask_user_question", "exit_plan_mode", "todo_write",
	"read", "write", "edit", "glob", "grep", "working_directory",
	"shell", "pwsh", "terminal", "present", "web_search", "web_fetch",
	"skill", "subagent", "subagent_fork",
]);

/* [v0.4] main_deny 初始名单(蓝本): 若干 MCP 工具——主会话直调频率近 0 而定义体量大,
 * 适合放在主会话禁用面。仅作参考蓝本, 运行期以 config.main_deny 为准。 */
const PKG_VERSION = (() => { try { return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version || ""; } catch { return ""; } })(); /* [v0.11] 版本单一权威源(package.json) */

function log(msg) { console.log(`[${NAME}] ${msg}`); }
function warn(msg) { console.warn(`[${NAME}] ${msg}`); }

/* ── 默认负面清单(治理蓝本: 10-12 image-tool-gates 实执行的画廊6 + 10-16 B类26
 *    + 本次 11-06 审计的高位/低语义件; 与调研文档 §5.4 Tier1 同源) ── */
const DEFAULT_BASELINE = [
	/* 文生图/画布 6(10-12 实执行名单原文) */
	"generate_image", "generate_images", "edit_image", "find_inspiration", "canvas_state", "view_canvas",
	/* MoA 9(对抗审查由主会话决策发起, 不在树内自发; 多套餐并行降幻觉=主会话级 MoA 已保障) */
	"moa_analyze", "moa_loop", "moa_hunt", "moa_hunt_2a", "moa_hunt_2b", "moa_hunt_full",
	"moa_roadmap", "moa_health", "moa_cache_probe",
	/* 宿主管家 5(宿主生命周期/治理权力不下放) */
	"dsh_web_restart", "plugin_manager", "provenance_audit", "video_cap_probe", "simulate_prune",
	/* goal/schedule 6(长任务/定时是主会话职权; schedule 工具名为宿主实际注册名) */
	"create_goal", "get_goal", "update_goal", "set_goal_durable",
	"schedule_create", "schedule_edit", "schedule_list", "schedule_view",
	/* 派单系 3(平级外送是主会话职权) */
	"illus_subagent", "preset_dispatch", "preset_send_message",
	/* 编排 1(多代理编排风暴入口) */
	"workflow",
	/* MCP 维护类 8(10-16 审计 C-2: 2,128 会话注入 0 使用; 检索类全保留) */
	"mcp__research-tools__add_whitelist", "mcp__research-tools__auto_refresh_auth",
	"mcp__research-tools__cleanup_browser_auth", "mcp__research-tools__clear_cache",
	"mcp__research-tools__test_network", "mcp__research-tools__get_whitelist",
	"mcp__zotero__discover", "mcp__zotero__similar",
];

let _lastCorruptAuditAt = 0;
function normPresetMap(v) { /* 逐键校验: 只收「键→非空字符串数组」, 坏键丢弃 */
	if (!v || typeof v !== "object" || Array.isArray(v)) return null;
	const out = {};
	for (const [k, arr] of Object.entries(v)) { if (Array.isArray(arr)) { const a = arr.map(String).filter(Boolean); if (a.length) out[k] = a; } }
	return Object.keys(out).length ? out : {};
}
function readConfig() {
	try {
		if (!existsSync(CFG_PATH())) return null;
		const c = JSON.parse(readFileSync(CFG_PATH(), "utf8"));
		return (c && typeof c === "object") ? c : null;
	} catch (e) {
		try { /* [v0.11.1] warn 与 audit 同入 60s 节流(防损坏期日志刷屏) */
			if (Date.now() - (_lastCorruptAuditAt || 0) > 60000) {
				_lastCorruptAuditAt = Date.now();
				warn("配置读取失败(回退内置默认, main/子代裁剪静默失效中!): " + String((e && e.message) || e));
				audit({ ts: new Date().toISOString(), ev: "config-corrupt", err: String((e && e.message) || e).slice(0, 160) });
			}
		} catch { /* noop */ }
		return null;
	}
}

/* ── lock 闸门文件(版本化发现台账; 唯一写者=本插件) ──
 * 结构: { version:1, autoDenyNew:true, updatedAt, tools: {
 *   "<name>": { state:"seen|pending|forced", firstSeen, ruledAt? } } }
 *   seen    = 已认领(裁决权威在 config.json, lock 只记历史)
 *   pending = 运行时新见且未裁决 → autoDenyNew 时并入裁剪(预先闸门)
 *   forced  = preset-scoped, restrict 不可达(面板灰显, 无法关闭)
 * 失效名(配置在/运行时无)不删不降级——保留可见性与未来重装复效(便于来源恢复后自动生效)。 */
function emptyLock(anchorPending = false) { return { version: 1, autoDenyNew: true, updatedAt: new Date().toISOString(), tools: {}, ...(anchorPending ? { anchorPending: true } : {}) }; }
function readLock() {
	try {
		if (!existsSync(LOCK_PATH())) return emptyLock();
		const l = JSON.parse(readFileSync(LOCK_PATH(), "utf8"));
		if (!l || typeof l !== "object" || !l.tools || typeof l.tools !== "object") {
			/* [v0.8.4 P1 锚定] 结构损坏不再静默重建空闸门(旧路径经 syncLock 首次建档
			 * 全员标 seen=闸门重置放行)——改锚定锁(anchorPending): 空 tools + 重建时
			 * 全员 pending(拦截方向), 并留台账可对账。 */
			warn("lock 结构损坏(锚定重建: 新名按 pending 拦截)");
			audit({ ts: new Date().toISOString(), ev: "lock-corrupt", mode: "anchor-pending" });
			return emptyLock(true);
		}
		return { version: 1, autoDenyNew: l.autoDenyNew !== false, updatedAt: l.updatedAt || "", tools: l.tools };
	} catch (e) {
		warn("lock 读取失败(锚定重建: 新名按 pending 拦截): " + String((e && e.message) || e));
		audit({ ts: new Date().toISOString(), ev: "lock-corrupt", mode: "anchor-pending", err: String((e && e.message) || e).slice(0, 120) });
		return emptyLock(true);
	}
}
/* [v0.8.4 P1 原子写] tmp+rename: 防"写一半中断"产生半文件(半文件经 readLock 锚定
 * 虽不再重置闸门, 但会全员 pending 扰动); rename 在同目录=同卷原子替换。 */
function atomicWrite(file, data) {
	const tmp = file + ".tmp-" + Date.now();
	writeFileSync(tmp, data, "utf8");
	renameSync(tmp, file);
}
function writeLock(lock) {
	try {
		lock.updatedAt = new Date().toISOString();
		mkdirSync(profileDir(), { recursive: true });
		delete lock.anchorPending; /* 锚定标记不落盘 */
		atomicWrite(LOCK_PATH(), JSON.stringify(lock, null, 1));
	} catch (e) { warn("lock 写入失败(闸门降级为内存态): " + String((e && e.message) || e)); }
}

/* 把运行时观测合并进 lock: 新名→pending; forced 名补标。返回是否变化(变化才写盘)。 */
function syncLock(lock, knownSet, cfg) {
	const autoDenyNew = cfg?.autoDenyNew !== false && lock.autoDenyNew !== false;
	let changed = false;
	const now = new Date().toISOString();
	for (const n of knownSet) {
		if (!lock.tools[n]) { lock.tools[n] = { state: "pending", firstSeen: now }; changed = true; }
	}
	/* 首次建档: 继承现状——lock 不改变建档前已有的子代理可见面, known 全员标 seen
	 * (baseline 内=已裁决禁, 其余=存量放行); pending 只对"建档后的新增"生效
	 * ——闸门语义=拦新不拦旧(只特判 baseline 会把其余存量工具误拦)。 */
	if (changed && !lock.anchorPending && Object.keys(lock.tools).length <= knownSet.size) {
		for (const n of knownSet) {
			if (lock.tools[n] && lock.tools[n].state === "pending") { lock.tools[n].state = "seen"; lock.tools[n].ruledAt = now; }
		}
	}
	lock.autoDenyNew = autoDenyNew;
	if (changed) writeLock(lock);
	return changed;
}

/* pending 件名单(autoDenyNew 时并入裁剪; preset_allow 豁免照常作用) */
function pendingDeny(lock, cfg) {
	if (cfg?.autoDenyNew === false || lock.autoDenyNew === false) return [];
	return Object.entries(lock.tools).filter(([, r]) => r && r.state === "pending").map(([n]) => n);
}

function effectiveDeny(cfg, preset, lock) {
	const base = Array.isArray(cfg?.baseline_deny) ? cfg.baseline_deny : DEFAULT_BASELINE;
	const exempt = new Set((cfg?.preset_allow && cfg.preset_allow[preset]) || []);
	const extra = (cfg?.preset_extra_deny && cfg.preset_extra_deny[preset]) || [];
	const pending = lock ? pendingDeny(lock, cfg) : [];
	return [...new Set([...base, ...pending].filter((n) => !exempt.has(n)).concat(extra))];
}

/* [v0.14.0 P2] 台账归档轮转: 当前档超阈值 ⇒ 轮转为 archive/audit-<ts>.jsonl。
 * **归档不删历史**: 轮转是改名(历史整份保留), 不是截断或清空。
 * 只有归档档数超 AUDIT_MAX_ARCHIVES 时才清最老的一档(极长期运行的兜底)。
 * 失败不阻断写入(审计写失败不能连累裁剪), 但会告警 —— 静默是本插件最大的
 * 历史教训(见 versions.md 的静默失败族)。
 *
 * 参数可注入(默认取模块常量): 让探针能**真调本函数**并指向隔离目录,
 * 而不是把逻辑再抄一份进测试 —— 抄副本正是本插件历史上的"同构副本假绿"陷阱
 * (48f222d → 71d4698 三轮才消灭)。 */
function rotateAuditIfNeeded(auditPath = AUDIT_PATH, archiveDir = AUDIT_ARCHIVE_DIR, maxBytes = AUDIT_MAX_BYTES) {
	try {
		if (!existsSync(auditPath)) return;
		const size = statSync(auditPath).size;
		if (size < maxBytes) return;
		mkdirSync(archiveDir, { recursive: true });
		/* [v0.14.0 P2 修] 档名唯一化: 毫秒时间戳**会撞**(同毫秒两次轮转 ⇒ 同名 ⇒
		 * renameSync 覆盖 ⇒ 静默丢整档历史, 直接违背"历史一条不丢"的承诺)。
		 * 修法: 目标已存在时**绝不覆盖**, 追加单调序号直到不冲突;
		 * 再加进程内序号兜底同毫秒内多次轮转。 */
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		let seq = 0;
		let dest = join(archiveDir, `audit-${stamp}.jsonl`);
		while (existsSync(dest)) {
			seq += 1;
			dest = join(archiveDir, `audit-${stamp}-${seq}.jsonl`);
			if (seq > 9999) { /* 理论不可能; 仍不覆盖, 直接放弃本轮轮转 */
				warn("台账归档档名冲突次数异常, 本轮不轮转");
				return;
			}
		}
		renameSync(auditPath, dest);
		log(`台账归档: ${(size / 1024).toFixed(0)}KB → ${dest}`);
		/* [v0.14.0 P2 修] 归档档数兜底: 有界保留(上限 AUDIT_MAX_ARCHIVES 档),
		 * 超出时清最老档 —— **删档必须留痕**(台账事件), 否则"历史一条不丢"就是假话。
		 * 诚实口径: 常规轮转一条不丢; 只有长期运行导致档数超上限时, 最老的档会被清理,
		 * 且清理动作本身进台账可见。 */
		try {
			const arch = readdirSync(archiveDir).filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl")).sort();
			while (arch.length > AUDIT_MAX_ARCHIVES) {
				const oldest = arch.shift();
				try {
					unlinkSync(join(archiveDir, oldest));
					log(`台账归档档数超上限, 清最老档: ${oldest}`);
					try { audit({ ts: new Date().toISOString(), ev: "archive-pruned", severity: "warn", file: oldest, kept: AUDIT_MAX_ARCHIVES }); } catch { /* noop */ }
				} catch { /* noop */ }
			}
		} catch { /* noop */ }
	} catch (e) {
		warn("台账归档失败(继续写入当前档): " + String((e && e.message) || e));
	}
}

function audit(record) {
	try {
		mkdirSync(AUDIT_DIR, { recursive: true });
		/* [v0.14.0 P2] 轮转检查节流: audit 是热路径(每次 agent 诞生都写),
		 * 每写一次都 statSync 会把 IO 放大到与写入同频。用计数节流:
		 * 每 64 次写才查一次大小(命中阈值时立即轮转, 不等计数)。 */
		if ((AUDIT_WRITES = (AUDIT_WRITES || 0) + 1) % 64 === 0) rotateAuditIfNeeded();
		appendFileSync(AUDIT_PATH, JSON.stringify(record) + "\n", "utf8");
	} catch (e) { warn("台账写入失败(裁剪已生效): " + String((e && e.message) || e)); }
}

/* [v0.14.0 P2 修] 真·尾读: 只读文件末尾若干字节, 向前回退到行边界。
 *
 * ★ 为什么必须真尾读(独立复核实测的缺陷): 旧实现注释写"尾读(只取文件末尾若干行)",
 *   实际是 `readFileSync(整个文件)` —— **注释与实现不符**。实测 24 档 × 5MB 时,
 *   limit=30 仍会同步读满 **120MB**, 阻塞宿主事件循环(冷盘更糟)。
 *   注释即契约: 说尾读就必须尾读。
 *
 * 算法: open → fstat 取大小 → 从末尾向前按块读, 每次块首若不是行边界就再往前
 *   退一行 —— 直到凑够 n 条记录或读到文件头。块大小按需增长(64KB 起)。
 *
 * 参数可注入(同 rotateAuditIfNeeded): 探针真调本函数指向隔离目录。 */
function readTailEntries(filePath, want) {
	const out = [];
	let fd = null;
	try {
		fd = openSync(filePath, "r");
		const size = fstatSync(fd).size;
		if (size <= 0) return out;
		let blockSize = 64 * 1024;
		let pos = size;
		let buf = "";
		/* 逐块向前读, 拼成 buf; 从 buf 末尾往前解析行。 */
		while (pos > 0 && out.length < want) {
			const readLen = Math.min(blockSize, pos);
			pos -= readLen;
			const chunk = Buffer.allocUnsafe(readLen);
			readSync(fd, chunk, 0, readLen, pos);
			buf = chunk.toString("utf8") + buf;
			/* 行切分: buf 可能是半个 UTF-8 字符(多字节被块边界切开)——
			 * 只影响首行解析, 极端情况下该行 JSON.parse 失败会被跳过, 不影响其余。 */
			const lines = buf.split("\n");
			/* 最后一段可能是"未读完的前半段", 留到下一轮; 其余是完整行。 */
			const tail = lines.pop();
			for (let i = lines.length - 1; i >= 0 && out.length < want; i--) {
				const l = lines[i].trim();
				if (!l) continue;
				try { const e = JSON.parse(l); if (e) out.push(e); } catch { /* 跳过坏行 */ }
			}
			buf = tail ?? "";
			if (pos > 0 && out.length < want) blockSize = Math.min(blockSize * 2, 4 * 1024 * 1024);
		}
		/* 收尾: buf 里还剩一段(文件头侧或最后一行) */
		if (out.length < want && buf) {
			const lines = buf.split("\n");
			for (let i = lines.length - 1; i >= 0 && out.length < want; i--) {
				const l = lines[i].trim();
				if (!l) continue;
				try { const e = JSON.parse(l); if (e) out.push(e); } catch { /* 跳过坏行 */ }
			}
		}
	} catch { /* noop */ }
	finally { try { if (fd !== null) closeSync(fd); } catch { /* noop */ } }
	return out;
}

/* [v0.14.0 P2] 跨档读取: 当前档 + 归档档(新→旧), 按时间倒序取最近 n 条。
 * 参数可注入(同 rotateAuditIfNeeded): 探针真调本函数指向隔离目录。 */
function readRecentAudit(limit, auditPath = AUDIT_PATH, archiveDir = AUDIT_ARCHIVE_DIR) {
	const n = Math.max(1, Math.min(200, Number(limit) || 30));
	const out = [];
	/* ① 当前档: 真尾读 */
	try {
		if (existsSync(auditPath)) {
			for (const e of readTailEntries(auditPath, n)) { out.push(e); if (out.length >= n) break; }
		}
	} catch { /* noop */ }
	if (out.length >= n) return out;
	/* ② 归档档: 由新到旧逐档补齐(每档也是真尾读) */
	try {
		if (existsSync(archiveDir)) {
			const arch = readdirSync(archiveDir)
				.filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
				.sort()
				.reverse();
			for (const f of arch) {
				if (out.length >= n) break;
				try {
					for (const e of readTailEntries(join(archiveDir, f), n - out.length)) {
						out.push(e);
						if (out.length >= n) break;
					}
				} catch { /* 跳过读不了的档 */ }
			}
		}
	} catch { /* noop */ }
	return out;
}

/* ── v0.4 主会话裁剪: depth0 专用(只裁显式 main_deny 名单, 不进 lock/pending;
 *     PROTECTED_MAIN 剔除; 求交预过滤同子代理款, 未知名静默记 missing 不炸) ── */
function gateMain(agent) {
	try {
		const cfg = readConfig();
		if (cfg && cfg.enabled === false) return { skipped: "disabled(配置开关)" };
		/* v0.7: preset 级治理上手开会话(depth0)——header.agentPreset 与子代路径同源
		 * (dsh-session :1055/:1840, 手选 preset 创建会话时写入)。语义:
		 *  - preset_allow[preset] 存在 → 正面清单制(restrict({allow}), main_deny 不再叠加
		 *    ——名单即意图; 治理手开 router/域会话的全局行工具叠加税);
		 *  - preset_extra_deny[preset] → 并入 main_deny 一起 deny(负面叠加制);
		 *  - 无 preset/无键 → 原 main_deny 逻辑不动(默认主会话行为不变)。 */
		const preset = agent?.session?.header?.agentPreset || "";
		/* [v0.11] 主会话按角色独立键: main_preset_* 优先; 未配置回落 v0.7 共用键(手开场景现行为不变);
		 * 共用键今后语义=子代侧(Tab👥), main_preset_*=主会话侧(Tab🧭)——两场景可分别配置 */
		const mAllow = cfg?.main_preset_allow?.[preset], mExtra = cfg?.main_preset_extra_deny?.[preset];
		/* 合法性回落(pick-first-valid)取代 ?? nullish 回落: main 键存在但非数组时回落共用键,
		 * 杜绝「非法值遮蔽合法共用键→静默 fail-open」; [] 仍=显式空正面清单(不回落) */
		const pickArr = (...cands) => { for (const c of cands) if (Array.isArray(c)) return c; return null; };
		const allowSrc = preset ? pickArr(mAllow, cfg?.preset_allow?.[preset]) : null;
		const allowCfg = allowSrc ? [...new Set(allowSrc)] : null;
		/* 回落可见化: 主会话侧未配 main_preset_allow 时回落共用键 preset_allow[preset],
		 * 且该键在主会话侧是 keep-only 语义(main_deny 不再叠加) —— 与子代理侧的
		 * "豁免"语义相反。不告警会被误读成"没配就没裁", 故显式提示。 */
		if (allowCfg && !Array.isArray(mAllow)) {
			warn(`主会话 preset "${preset}" 未配 main_preset_allow, 回落共用键 preset_allow[${preset}] → 该键在主会话侧按 keep-only 生效(main_deny 不叠加)`);
		}
		const extraDeny = preset ? (pickArr(mExtra, cfg?.preset_extra_deny?.[preset]) || []) : [];
		/* 语义: 只认 config 显式名单(无 config/无字段=不裁; DEFAULT_MAIN_DENY 仅蓝本) */
		const deny = [...new Set([...(Array.isArray(cfg?.main_deny) ? cfg.main_deny : []), ...extraDeny])];
		if (!allowCfg && !deny.length) return { skipped: "depth0(无 main_deny/无 preset 键)" };
		const parentCtx = agent?.ctx;
		if (!parentCtx || typeof parentCtx.extend !== "function") {
			warn(`main.ctx 缺失 —— 跳过 ${agent?.id}`);
			return { skipped: "no-agent-ctx" };
		}
		const scoped = createScope(parentCtx, agent);
		const sctx = scoped.ctx;
		const tools = sctx.get("tools");
		if (!tools || typeof tools.restrict !== "function" || typeof tools.view !== "function") {
			try { scoped.dispose?.(); } catch { /* noop */ }
			warn(`main scoped tools 句柄缺失 —— 跳过 ${agent?.id}`);
			return { skipped: "no-tools-service" };
		}
		/* v0.4.6: view 参数=scope key(agent 对象); 传 sctx 是错参(恒读纯全局层) */
		const known = tools.view(agent).restrictableNames;
		let mode = "deny", applicable = [], missing = [], blocked = [];
		if (allowCfg) {
			mode = "allow";
			applicable = allowCfg.filter((n) => known.has(n));
			missing = allowCfg.filter((n) => !known.has(n));
			if (applicable.length > 0) tools.restrict({ allow: applicable });
		} else {
			/* 保护集剔除 + 求交: 未知名记 missing(探针), 不 throw */
			const wantedRaw = deny;
			blocked = wantedRaw.filter((n) => PROTECTED_MAIN.has(n));
			if (blocked.length) warn(`main_deny 含保护件(已剔除): ${blocked.join(",")}`);
			const wanted = wantedRaw.filter((n) => !PROTECTED_MAIN.has(n));
			applicable = wanted.filter((n) => known.has(n));
			missing = wanted.filter((n) => !known.has(n));
			if (applicable.length > 0) tools.restrict({ deny: applicable });
		}
		const visibleAfter = tools.view(agent).visible.size;
		SCOPES.set(agent.id, scoped);
		const rec = { ts: new Date().toISOString(), agentId: agent.id, depth: 0, preset: preset || "(main)", mode, denied: mode === "allow" ? allowCfg.length : applicable.length, allowed: mode === "allow" ? applicable.length : undefined, pendingDenied: [], missing, visibleAfter };
		audit(rec);
		log(`主会话裁剪: ${agent.id.slice(0, 24)} preset=${preset || "(main)"} mode=${mode} ${mode === "allow" ? `allow=${applicable.length}/${allowCfg.length}` : `deny=${applicable.length}`}${missing.length ? ` 缺名=${missing.length}` : ""}${blocked.length ? ` 保护剔除=${blocked.length}` : ""} 面=${rec.visibleAfter}`);
		return rec;
	} catch (e) {
		/* fail-open: 主会话裁剪失败绝不阻断启动; [v0.8.4 P1] 补台账让失败可对账 */
		warn(`主会话裁剪异常(${agent?.id}): ${String((e && e.message) || e)}`);
		try { audit({ ts: new Date().toISOString(), agentId: agent?.id, depth: 0, ev: "gate-error", scope: "main", err: String((e && e.message) || e).slice(0, 200) }); } catch { /* noop */ }
		return { error: String((e && e.message) || e) };
	}
}

/* [v0.13.2] 派发时快照主会话的工具定义(补挂源)。
 * 为什么在派发侧抓而不是在子代创建时读实时面:
 *   子代创建时读主会话实时面 → 主会话面一变(改 main_deny / pending 进件 /
 *   新工具出现), 补挂就补不上 → 子代理面跟着漂移(实测同标签 literature-lead
 *   的面在 23 与 25 之间跳)。快照后, 已派出的子代理(含续派/冷恢复)都用这份
 *   快照补挂 → 面稳定不变, 与主会话此后怎么变无关。
 *
 * 取法与 gateMain/gateComposed 一致: 借父 agent 的 ctx 建一个临时 scope 拿
 * tools 句柄, 再在 agents.list() 里挑 depth0 中 visible 最大者(真实主会话)。
 * 失败不阻断派发 —— gateComposed 会回落到实时面。
 *
 * @param {object} parent 派发的父 agent
 * @param {Array<Set<string>>} allowLists 各子代理的 allow 名单(取并集抓定义)
 * @returns {Map<string, object>|null} 工具名 → 定义
 */
function captureMainToolDefs(parent, allowLists) {
	try {
		const names = new Set();
		for (const s of allowLists) for (const n of s) names.add(n);
		if (!names.size) return null;
		const parentCtx = parent?.ctx;
		if (!parentCtx || typeof parentCtx.extend !== "function") return null;
		const scoped = createScope(parentCtx, parent);
		try {
			const sctx = scoped.ctx;
			/* sctx 可能是裁剪过的 scope, 不保证有 get —— 缺了就退回父 ctx / ROOT_CTX */
			const sGet = (n) => {
				if (typeof sctx?.get === "function") { try { return sctx.get(n); } catch { /* fallthrough */ } }
				try { return parentCtx.get?.(n); } catch { /* fallthrough */ }
				return ROOT_CTX?.get?.(n);
			};
			const tools = sGet("tools");
			if (!tools || typeof tools.view !== "function") return null;
			/* 真实主会话 = depth0 里 visible 最大者(重启恢复期常有多个 depth0) */
			let mainAgent = null, bestSize = -1;
			const agents = sGet("agents");
			if (agents?.list) {
				for (const a of agents.list()) {
					if ((a?.session?.header?.delegationDepth ?? 1) !== 0) continue;
					let size = -1;
					try { size = tools.view(a).visible.size; } catch { continue; }
					if (size > bestSize) { mainAgent = a; bestSize = size; }
				}
			}
			/* 拿不到主会话则用父自己的面兜底(父也是 depth0 通常) */
			const viewSrc = mainAgent ? tools.view(mainAgent) : tools.view(parent);
			const defs = new Map();
			for (const n of names) {
				try {
					const def = viewSrc?.visible?.get(n) || viewSrc?.registrations?.get(n)?.definition;
					if (def) defs.set(n, def);
				} catch { /* 单个名字失败不影响其余 */ }
			}
			return defs.size ? defs : null;
		} finally {
			try { scoped.dispose?.(); } catch { /* noop */ }
		}
	} catch (e) {
		warn(`composed 快照采集失败(退回实时面): ${String((e && e.message) || e)}`);
		return null;
	}
}

/* ── composed 子代裁剪: allow(keep-only)+补挂双轨 ──────────────────────
 * 宿主 API 语义(源码核实):
 *   ① restrict({allow}) 只作用继承层(全局+祖先层); own 层(子代自注册=preset 行/
 *      补挂)豁免 restrictions 且直接 visible;
 *   ② view(scope) 参数是 **scope key(agent 对象)**——传 ctx 则层链为空,
 *      恒读纯全局层(错参会让裁剪结果读不出来; restrict 自身按 scope 正确解析
 *      key, 故常规 deny 裁剪一直真实生效);
 *   ③ 子代绑空壳(dtg-shell, 零工具行) ⇒ own 层无 preset 工具行,
 *      最终面 = 全局层×allow裁剪 + 补挂 own 层, 精确可控;
 *   ④ 补挂定义来源: 任意 tools 实例 .view(mainAgent)——层注册表是单例,
 *      按传入 key 寻址与调用实例无关; 主会话 own 层
 *      (preset 行 web/read 等)的定义由此取得, tools.register(def) 注册到
 *      子代 own 层(scopeOf(sctx)=agent key)。 */
function gateComposed(agent, cap, depth) {
	log(`[composed-debug] gateComposed 入口 agent.id=${agent?.id} label=${cap.label}`);
	try {
		const parentCtx = agent?.ctx;
		if (!parentCtx || typeof parentCtx.extend !== "function") {
			PENDING_CAPS.delete(agent?.id);
			warn(`composed.ctx 缺失 —— 退常规裁剪 ${agent?.id}`);
			return { skipped: "no-agent-ctx" };
		}
		const scoped = createScope(parentCtx, agent);
		const sctx = scoped.ctx;
		const tools = sctx.get("tools");
		if (!tools || typeof tools.restrict !== "function" || typeof tools.view !== "function" || typeof tools.register !== "function") {
			try { scoped.dispose?.(); } catch { /* noop */ }
			PENDING_CAPS.delete(agent.id);
			warn(`composed tools 句柄缺失 —— 退常规裁剪 ${agent.id}`);
			return { skipped: "no-tools-service" };
		}
		/* 主会话 agent 对象(depth0): 补挂定义来源
		 * [v0.8.1] 取 visible 最大者(同 gateAgent supplement 修复): 重启恢复期
		 * 多个 depth0 并存时"第一个"可能是无 preset 行集的瞬态会话。 */
		let mainAgent = null;
		try {
			const agents = sctx.get("agents") || ROOT_CTX?.get?.("agents");
			if (agents?.list) {
				let bestSize = -1;
				for (const a of agents.list()) {
					if ((a?.session?.header?.delegationDepth ?? 1) !== 0) continue;
					let size = -1;
					try { size = tools.view(a).visible.size; } catch { continue; }
					if (size > bestSize) { mainAgent = a; bestSize = size; }
				}
			}
		} catch (e) { warn(`agents 枚举失败(补挂降级为纯裁剪): ${String((e && e.message) || e)}`); }
		const known = tools.view(agent).restrictableNames;
		/* [v0.13.4 P0-B] baseline 兜底差集(防御纵深第二层): 入口闸已拒绝 baseline
		 * 件, 这里兜旧版残留预挂/派发后配置变更/异常构造的 cap —— 不入 keep-only、
		 * 不补挂, warn+audit(不静默)。dispatch_composed 单件豁免与入口闸同口径
		 * (级联机制自身受双闸闭环, 保 lead 标签工作)。baseline 以 readConfig 生效值
		 * 为准, 勿硬编码常量。 */
		const cfgG = readConfig();
		const BASE = new Set(Array.isArray(cfgG?.baseline_deny) ? cfgG.baseline_deny : DEFAULT_BASELINE);
		BASE.delete("dispatch_composed");
		const blockedBase = [...cap.allow].filter((n) => BASE.has(n));
		if (blockedBase.length) {
			warn(`composed baseline 底线拦截(label=${cap.label}): ${blockedBase.join(",")} —— 不入 allow/不补挂`);
			try { audit({ ts: new Date().toISOString(), agentId: agent.id, depth, ev: "composed-baseline-block", label: cap.label, names: blockedBase }); } catch { /* noop */ }
		}
		const allowList = [...cap.allow].filter((n) => known.has(n) && !BASE.has(n));
		const dropped = cap.allow.size - allowList.length - blockedBase.length;
		/* ① 裁继承层: keep-only(allowList 允许为空=裁光全局层, 面全靠补挂) */
		tools.restrict({ allow: allowList });
		/* ② 补挂: 不在可裁集的目标名(preset 行工具), 从**派发时快照的定义**注册到
		 * 子代 own 层(豁免 restrictions, 直接 visible)。
		 * [v0.13.2] 优先用快照(cap.defs): 派发时抓一次主会话的定义, 之后子代理面
		 * 与主会话实时面解耦 —— 续派/并行时主会话面变了也不影响子代理面
		 * (旧形态取实时主会话面 → 同标签的子代理面在 23 与 25 之间漂移)。
		 * 快照缺失时回落实时主会话面(兼容旧预挂记录)。 */
		const supplemented = [];
		let mainView = null;
		if (mainAgent) { try { mainView = tools.view(mainAgent); } catch (e) { warn(`主会话 view 失败: ${String((e && e.message) || e)}`); } }
		const snap = cap.defs instanceof Map ? cap.defs : null;
		let fromSnap = 0, fromLive = 0;
		for (const name of cap.allow) {
			if (BASE.has(name)) continue; /* baseline 兜底已拦(上文 warn+audit), 双保险不 register */
			if (known.has(name)) continue; /* 已在可裁集, restrict 已保留 */
			try {
				const def = (snap && snap.get(name)) || mainView?.visible?.get(name) || mainView?.registrations?.get(name)?.definition;
				if (def) {
					tools.register(def); /* 注册到子代 own 层(scopeOf(sctx)=agent) */
					supplemented.push(name);
					if (snap && snap.has(name)) fromSnap++; else fromLive++;
				} else {
					warn(`composed 补挂无定义(${name}): 快照与主会话面都没有 —— 弃(面外)`);
				}
			} catch (e) {
				warn(`composed 补挂失败(${name}): ${String((e && e.message) || e)}`);
			}
		}
		const visibleAfter = tools.view(agent).visible.size;
		SCOPES.set(agent.id, scoped);
		const rec = {
			ts: new Date().toISOString(), agentId: agent.id, depth,
			preset: `(composed:${cap.label})`, allowed: allowList.length,
			droppedUnknown: dropped, baselineBlocked: blockedBase.length, visibleAfter, knownCount: known.size,
			supplemented: supplemented.length, supplementedNames: supplemented,
			/* [v0.13.2] 补挂来源与认领次数: 快照优先(面稳定), used>1 = 该子代理被续派过 */
			supplementedFromSnapshot: fromSnap, supplementedFromLive: fromLive, claimCount: cap.used || 1,
		};
		audit(rec);
		log(`composed 裁剪: ${agent.id.slice(0, 24)} 面标签=${cap.label} allow=${allowList.length}/${known.size}(可裁)+补挂${supplemented.length} 面=${rec.visibleAfter}${dropped ? ` 丢弃未知=${dropped}` : ""}${blockedBase.length ? ` baseline拦=${blockedBase.length}` : ""}`);
		return rec;
	} catch (e) {
		PENDING_CAPS.delete(agent?.id);
		warn(`composed 裁剪异常(${agent?.id}, 退常规): ${String((e && e.message) || e)}`);
		return { error: String((e && e.message) || e) };
	}
}

/* ── lossless JSON 净化(v0.13.3)──────────────────────────────────────────
 * 宿主 dsh-tools/lib/pipeline.js:797 snapshotToolValue 对 execute 返回值做
 * snapshotJsonValue; dsh-util-values/lib/index.js:676 walkJsonValue:701
 * 判定「任一属性值为 undefined / NaN / ±Infinity / -0 ⇒ 整个对象非法」,
 * 宿主随即抛 ToolOutputError「value is not lossless JSON」。
 *
 * 生产事故(2026-11-11): dispatch_composed 的 wait=true 路径把
 * stopReason / error 以 undefined 写入返回值 ⇒ 每次 wait=true 必炸
 * 「returned invalid output: value is not lossless JSON」(子代理其实已派出、
 * 结果也正常异步投递, 只是工具返回值非法)。
 *
 * 修法: 出口统一净化 —— 剔掉 undefined 值(键整个不写)、非有限数转 null、
 * 数组里的 undefined 转 null、非 JSON 对象**显式映射**为可读形态。
 *
 * ── [v0.14.0 修] 为什么不能"静默丢弃"(盲审 + 独立复核指出的缺陷) ──────────
 * 初版对非普通原型对象(Date/Map/Error/class 实例)**整个键省略**。实测:
 *   toLossless({ error: new Error("boom") }) ⇒ { }   ← **error 键消失**
 * 调用方拿到残缺对象却**没有任何错误指示** —— 一条失败被渲染成"成功且无错误",
 * 正是本插件自己批判过的"静默失败"族。深度超 12 也是静默变 null。
 * 现改为**显式映射**:
 *   Error      → { __lossless: "Error", name, message, stack? }
 *   Date       → { __lossless: "Date", iso }
 *   Map/Set    → { __lossless: "Map"|"Set", size, entries? }
 *   RegExp     → { __lossless: "RegExp", source, flags }
 *   其他对象   → { __lossless: "<构造名>", } + 可枚举自有属性(尽力而为)
 *   深度超限   → { __lossless: "DepthExceeded" }
 * ⇒ 值总在, 且**带标记**, 调用方与面板都能看出"这里原本不是 JSON 值"。
 */
function toLossless(value, depth = 0) {
	if (value === null) return null;
	const t = typeof value;
	if (t === "string" || t === "boolean") return value;
	if (t === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
	if (t === "bigint") return Number(value);
	if (t === "undefined" || t === "function" || t === "symbol") return undefined;
	if (depth > 12) return { __lossless: "DepthExceeded", depth };
	if (Array.isArray(value)) return value.map((v) => { const x = toLossless(v, depth + 1); return x === undefined ? null : x; });
	if (t === "object") {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) {
			/* [v0.14.0 修] 非普通原型 ⇒ **显式映射**, 不静默丢键。 */
			const ctor = (value.constructor && value.constructor.name) || "Object";
			if (value instanceof Error) {
				const e = { __lossless: "Error", name: String(value.name || "Error"), message: String(value.message || "") };
				if (typeof value.stack === "string") e.stack = value.stack;
				return e;
			}
			if (value instanceof Date) return { __lossless: "Date", iso: Number.isNaN(value.getTime()) ? null : value.toISOString() };
			if (value instanceof RegExp) return { __lossless: "RegExp", source: String(value.source), flags: String(value.flags) };
			if (value instanceof Map) return { __lossless: "Map", size: value.size, entries: [...value.entries()].map(([k, v]) => [toLossless(k, depth + 1), toLossless(v, depth + 1)]) };
			if (value instanceof Set) return { __lossless: "Set", size: value.size, values: [...value.values()].map((v) => toLossless(v, depth + 1)) };
			/* 其它(class 实例 / 宿主句柄): 标记 + 尽力枚举自有可枚举属性。
			 * 宿主句柄(如 AbortController)的属性多为不可枚举, 拿不到就只留标记 ——
			 * 至少"这里原本不是 JSON 值"这件事不会被吞掉。 */
			const out = { __lossless: ctor };
			try {
				for (const [k, v] of Object.entries(value)) {
					const x = toLossless(v, depth + 1);
					if (x !== undefined) out[k] = x;
				}
			} catch { /* getter 抛错: 保留标记即可 */ }
			return out;
		}
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			const x = toLossless(v, depth + 1);
			if (x !== undefined) out[k] = x;
		}
		return out;
	}
	return undefined;
}

/* ── [v0.14.0 P1] 工具注册统一入口: 出口强制 lossless 净化 ────────────────
 * 结构性修法, 取代 v0.13.3 的"只给 dispatch_composed 加出口净化"——
 * 那次只修了**已踩坑的那一个工具**, 另三个仍是裸返回, 于是同一类缺陷留着复发面。
 *
 * 统一入口的价值: 以后**新增**工具走 registerTool() ⇒ 出口自动净化,
 * 不可能漏(逐个加守卫则每次新增都要记得加, 迟早再漏一次)。
 *
 * 净化契约(与 toLossless 一致): 剔掉 undefined 值(键整个不写)、非有限数→null、
 * 数组内 undefined→null、丢弃非普通原型对象(宿主句柄等)。语义不变,
 * 只保证返回值是宿主能接受的 lossless JSON。
 *
 * 兜底: 净化后若整体不可用(例如返回值本身就是 undefined), 返回一个可读的
 * 错误对象而不是让宿主抛 "value is not lossless JSON"(后者对用户不可读)。
 */
function registerTool(ctx, definition, label) {
	const orig = definition.execute;
	if (typeof orig !== "function") return ctx.tools.register(definition);
	const wrapped = {
		...definition,
		async execute(args, exec) {
			const out = await orig.call(definition, args, exec);
			const clean = toLossless(out);
			if (clean === undefined) {
				return { ok: false, error: `${label} 返回值无法净化为 lossless JSON(宿主会拒收)` };
			}
			return clean;
		},
	};
	return ctx.tools.register(wrapped);
}

/* ── 核心裁剪: 同步、纯内存+偶发小文件、微秒~毫秒级(agent/created serial 事件不可阻塞) ── */
function gateAgent(agent) {
	try {
		/* [v0.14.0 P0] 降级守卫: peer 未就绪 ⇒ 治理**停用**。
		 *
		 * ★ 姿态修正(MoA 三路盲审一致 + 独立复核实测): 初版是
		 *   `return { skipped: "peer-missing(降级)" }` = **fail-open** ——
		 *   agent 拿到完整工具面, 而治理看起来"正常"(只是 skip 了一下)。
		 *   这与本插件自己批判过的"静默失败"根因**自相矛盾**:
		 *   裁剪是**安全控制**, 缺位必须 fail-closed, 不能 fail-open。
		 *   现行为: 该 agent **显式拒绝裁剪**(error 而非 skipped) + 台账记
		 *   severity=fatal + 降级事实走**不依赖 peer/profileContext 的通道**。
		 *
		 * ★ 为什么不阻断宿主启动: 实测宿主 boot 的 installFailLoud 路径 ——
		 *   插件树加载失败会**杀死整个 profile**。插件没有否决宿主的资格,
		 *   所以降级只停"治理", 不停宿主。
		 * ★ 为什么不卸面板: 面板是唯一能让人看见"治理没生效"的通道,
		 *   把它一起卸掉 = 自断观测通路(盲审指出的"观测通道与失败源同源"缺陷)。
		 *   面板改为**始终挂载**, 用 status() 的 degraded 字段报告。
		 */
		if (!peersReady()) {
			const reason = String(peerError() || "宿主 peer 未就绪");
			try { audit({ ts: new Date().toISOString(), agentId: agent?.id, ev: "gate-degraded", severity: "fatal", scope: "peer-missing", err: reason.slice(0, 200) }); } catch { /* noop */ }
			/* 独立可见通道: 不依赖 peer、不依赖 profileContext(审计写失败时仍能报)。 */
			try { writeFileSync(join(AUDIT_DIR, "DEGRADED"), `dsh-depth-tool-gate 治理降级\n时间: ${new Date().toISOString()}\n原因: ${reason}\n`, "utf8"); } catch { /* noop */ }
			return { error: `治理降级(宿主 peer 未就绪): ${reason.slice(0, 160)}` };
		}
		const header = agent?.session?.header;
		const depth = header?.delegationDepth ?? 0;
		if (depth <= 0) return gateMain(agent); /* [v0.4] depth0 也过闸(main_deny 显式名单) */
		const cap = PENDING_CAPS.get(agent?.id);
		log(`[composed-debug] agent.id=${agent?.id} PENDING_CAPS.size=${PENDING_CAPS.size} keys=${[...PENDING_CAPS.keys()].map(k=>k.slice(0,12)).join(",")} hit=${!!cap}`);
		if (cap) {
			/* [v0.13.2] 认领后**不删除**预挂: 续派/冷恢复会重新物化 agent 并再次
			 * 触发 agent/created, 命中同一份 allow 名单 → 工具面保持不变。
			 * 旧形态在这里 delete, 于是续派时认领失败 → 落回普通 deny 裁剪 →
			 * 面完全变了(实测 109 → 5)。清理交给 TTL 清扫。 */
			cap.used = (cap.used || 0) + 1;
			const r = gateComposed(agent, cap, depth);
			if (!r?.error && !r?.skipped) return r; /* 失败/缺件 → 落回下文常规 deny 裁剪兜底 */
		} /* [v0.4.2] dispatch_composed 预挂子代 */
		const cfg = readConfig();
		if (cfg && cfg.enabled === false) return { skipped: "disabled(配置开关)" };
		const parentCtx = agent?.ctx;
		if (!parentCtx || typeof parentCtx.extend !== "function") {
			warn(`agent.ctx 缺失/不可 extend —— 跳过 ${agent?.id}`);
			audit({ ts: new Date().toISOString(), agentId: agent?.id, depth, skipped: "no-agent-ctx" });
			return { skipped: "no-agent-ctx" };
		}
		/* 作用域构造(两连修正定案, 详见 v0.2 注释): createScope(agent.ctx, agent)
		 * 造真 scoped ctx, restrict() 内 scopeOf 命中; scope 随 agent 存活。 */
		const scoped = createScope(parentCtx, agent);
		const sctx = scoped.ctx;
		const tools = sctx.get("tools");
		if (!tools || typeof tools.restrict !== "function" || typeof tools.view !== "function") {
			warn(`scoped tools 句柄缺失 —— 跳过 ${agent?.id}`);
			try { scoped.dispose?.(); } catch {}
			audit({ ts: new Date().toISOString(), agentId: agent?.id, depth, skipped: "no-tools-service" });
			return { skipped: "no-tools-service" };
		}
		const known = tools.view(agent).restrictableNames; /* key=agent 对象 */
		/* preset_deny: preset 访问控制——名单内 preset 不允许作为子代被派单调用
		 * (不论通道)。实现=创建时 restrict 到最小回报面; 台账记 preset-denied;
		 * 不 throw(agent/created 为串行事件, 监听不可炸)。depth0 主会话/手开会话不受限。
		 * fail-closed: minimal 不在 known 或 restrict 抛错时兜底 deny 全部已知工具
		 * ——被禁子代绝不保留完整面; SCOPES.set/syncLock 前置(早退不泄 fiber/不跳发现);
		 * 台账带 degraded 标志。 */
		SCOPES.set(agent.id, scoped);
		const lock = readLock();
		const newSeen = syncLock(lock, known, cfg);
		const childPreset = header?.agentPreset || "";
		if (childPreset && Array.isArray(cfg?.preset_deny) && cfg.preset_deny.includes(childPreset)) {
			let applied = false, degraded = false;
			try {
				const minimal = ["note_search", "send_message"].filter((n) => known.has(n));
				if (minimal.length > 0) {
					tools.restrict({ allow: minimal });
					const after = tools.view(agent);
					applied = !!(after && minimal.every((n) => after.visible.has(n)));
				}
				if (!applied) { tools.restrict({ deny: [...known] }); degraded = true; }
			} catch (e) {
				try { tools.restrict({ deny: [...known] }); degraded = true; } catch (e2) { warn(`preset_deny fail-closed 兑底也失败: ${String(e2)}`); }
				warn(`preset_deny restrict 异常(已兑底): ${String(e)}`);
			}
			warn(`[preset_deny] 子代 preset "${childPreset}" 在禁用名单 —— ${degraded ? "deny 全量兑底" : "已限制到最小回报面"}`);
			audit({ ts: new Date().toISOString(), agentId: agent?.id, depth, ev: "preset-denied", preset: childPreset, degraded, restrictApplied: !degraded });
			return { denied: "preset_deny", degraded };
		}
		/* wanted∩missing 中的 forced 名 → lock 标 forced(探针记录) */
		const wanted0 = effectiveDeny(cfg, header?.agentPreset || "", lock);
		const missing0 = wanted0.filter((n) => !known.has(n));
		let forcedChanged = false;
		for (const n of missing0) {
			if (FORCED_NAMES.has(n) && lock.tools[n] && lock.tools[n].state !== "forced") { lock.tools[n].state = "forced"; forcedChanged = true; }
		}
		if (forcedChanged) writeLock(lock);
		/* 最终名单: pending 并入后与运行时求交(未知名已被交集预过滤, 0.2.2 throw 不触发) */
		const wanted = effectiveDeny(cfg, header?.agentPreset || "", lock);
		const applicable = wanted.filter((n) => known.has(n));
		const missing = wanted.filter((n) => !known.has(n));
		const pendingDenied = applicable.filter((n) => lock.tools[n]?.state === "pending");
		if (applicable.length > 0) tools.restrict({ deny: applicable });
		/* [v0.8] preset_supplement: 名单内 preset 的外送会话按 preset_allow 正面清单
		 * 补挂缺件(复用 composed 补挂机制: 定义取 depth0 主会话 view, 注册 own 层
		 * 豁免 restrictions 直接 visible)。动因: preset_dispatch/illus provider 开的
		 * 平级会话不挂 preset 行集, 面仅剩"全局层∩通道域裁剪∩dtg 裁剪"(cordis-router
		 * 实测 6/19 件); 补挂后外送与 UI 手开(自治理 restrict)面一致。 */
		const supRec = { count: 0, names: [] };
		if (Array.isArray(cfg?.preset_supplement) && cfg.preset_supplement.includes(header?.agentPreset || "")
			&& Array.isArray(cfg?.preset_allow?.[header.agentPreset]) && typeof tools.register === "function") {
			/* [v0.8.1] depth0 检索取 visible 最大者: 重启恢复期 agents.list() 常有多个
			 * depth0(瞬态/裸会话), 取"第一个"会命中无 preset 行集的会话 → 派单系 def
			 * 取不到(08:16:13Z 实测补挂 2/13); 真实主会话=唯一挂满行集(visible 最大)。 */
			let mainView = null;
			try {
				const agents = sctx.get("agents") || ROOT_CTX?.get?.("agents");
				if (agents?.list) {
					let best = null, bestSize = -1;
					for (const a of agents.list()) {
						if ((a?.session?.header?.delegationDepth ?? 1) !== 0) continue;
						let size = -1;
						try { size = tools.view(a).visible.size; } catch { continue; }
						if (size > bestSize) { best = a; bestSize = size; }
					}
					if (best) { try { mainView = tools.view(best); } catch { /* keep null */ } }
				}
			} catch (e) { warn(`supplement agents 枚举失败: ${String((e && e.message) || e)}`); }
			if (mainView) {
				for (const name of cfg.preset_allow[header.agentPreset]) {
					/* [v0.8.3] 只认 visible: known(restrictableNames)含"注册表存在但本会话
					 * 行集未挂"的名字, deny 模式下 restrict 不会保留它们 —— known 跳过是
					 * gateComposed(keep-only)语义误植, 2/13 补挂失败根因(已实测终验 19/19)。 */
					if (tools.view(agent).visible.has(name)) continue;
					try {
						const def = mainView.visible?.get(name) || mainView.registrations?.get(name)?.definition;
						if (def) { tools.register(def); supRec.count++; supRec.names.push(name); }
						else warn(`supplement 补挂无定义(${name}): 主会话面也没有 —— 弃`);
					} catch (e) { warn(`supplement 补挂失败(${name}): ${String((e && e.message) || e)}`); }
				}
			}
		}
		const visibleAfter = tools.view(agent).visible.size; /* v0.4.6: key=agent */
		/* restriction 落在 ScopedLayers.scoped(Map, 键=agent 对象), disposer 绑在
		 * scope fiber 上——scope 必须随 agent 存活: agent/disposed 才 dispose。 */
		SCOPES.set(agent.id, scoped);
		const rec = {
			ts: new Date().toISOString(), agentId: agent.id, depth,
			preset: header?.agentPreset || "", denied: applicable.length,
			pendingDenied, missing, visibleAfter,
		};
		if (supRec.count) { rec.supplemented = supRec.count; rec.supplementedNames = supRec.names; }
		if (newSeen) rec.lockNewNames = Object.entries(lock.tools).filter(([, r]) => r?.state === "pending").map(([n]) => n).length;
		audit(rec);
		log(`子代理裁剪: ${agent.id.slice(0, 24)} depth=${depth} preset=${rec.preset || "-"} deny=${applicable.length}(pending ${pendingDenied.length}) 面=${rec.visibleAfter}${missing.length ? ` 缺名=${missing.length}` : ""}${newSeen ? " [lock+new]" : ""}${supRec.count ? ` 补挂=${supRec.count}(${supRec.names.slice(0, 5).join(",")}${supRec.names.length > 5 ? "…" : ""})` : ""}`);
		return rec;
	} catch (e) {
		/* fail-open: 裁剪失败绝不阻断子代理启动; [v0.8.4 P1] 补台账让失败可对账 */
		warn(`裁剪异常(${agent?.id}): ${String((e && e.message) || e)}`);
		try { audit({ ts: new Date().toISOString(), agentId: agent?.id, ev: "gate-error", scope: "child", err: String((e && e.message) || e).slice(0, 200) }); } catch { /* noop */ }
		return { error: String((e && e.message) || e) };
	}
}

/* ── 运行时快照(面板"自动发现面"与 lock 对账的数据源) ──
 * 取**全局视角**的 restrictableNames(全局行+host 插件行, 不含 preset-scoped 名)。
 *
 * [v0.14.0 修] 旧形态是 `createScope(ROOT_CTX, 合成key)` + `tools.view(sctx)`:
 *   ① view() 的参数必须是 **scope key**, 传 ctx 只会读**纯全局层**(实测
 *      view(sctx)/view(ctx)/view(undefined) 三者等价, 只有 view(agent) 才读 agent 层);
 *   ② 为了拿"全局名"去造一个临时 scope 是多余的 —— 全局视角就是 view(undefined)。
 * 现在直接用全局工具服务的 view(undefined): 不造 scope ⇒ 也不依赖 peer ⇒
 * **降级模式下依然可用**(面板的"自动发现面"不因治理降级而瞎)。
 * (原实现的 visibleCount 取的是全局可见数, 注释写的"depth-0 视角"与实现不符,
 *  顺手改正: 全局视角就是全局视角。) */
function snapshotNames() {
	if (!ROOT_CTX || !TOOLS) return null;
	try {
		const view = TOOLS.view(undefined);
		return { restrictable: [...view.restrictableNames].sort(), visibleCount: view.visible?.size ?? null, ts: new Date().toISOString() };
	} catch (e) {
		warn("snapshot 失败: " + String((e && e.message) || e));
		return null;
	}
}

/* ── 面板数据面(闭包服务对象 + 网关双通道, 照 shim-panel 范式) ── */
const gateSvc = {
	status() {
		const cfg = readConfig();
		return {
			ok: true, enabled: cfg?.enabled !== false, config_path: CFG_PATH(),
			config: cfg || { baseline_deny: DEFAULT_BASELINE },
			default_baseline: DEFAULT_BASELINE,
			default_capabilities: DEFAULT_CAPABILITIES, /* Tab5 能力标签编辑的数据源 */
			audit_path: AUDIT_PATH, lock_path: LOCK_PATH(),
				/* [v0.11] 单一权威源下发: 版本与保护集以 host 为准, 客户端镜像仅回退 */
				version: PKG_VERSION, protected_main: [...PROTECTED_MAIN],
				/* [v0.14.0 P0] 降级可见性: peer 未就绪 ⇒ 治理停用, 面板必须显示出来。
				 * (静默不裁剪 = fail-open 假装正常, 比崩更危险) */
				degraded: !peersReady(),
				degraded_reason: peersReady() ? null : String(peerError() || "宿主 peer 未就绪"),
		};
	},
	save(payload) {
		try {
			const curRaw = readConfig();
			const curCfg = curRaw || {};
			if (!curRaw) { try { audit({ ts: new Date().toISOString(), ev: "config-rebuilt-from-panel", note: "损坏/缺失态下的面板保存: 名单以面板 draft 为准(原值不可读)" }); } catch { /* noop */ } } /* [v0.11.1 MoA P1] 重建可追溯 */
			/* [v0.8.4 P0-A 修复] spread 保真: 未透传键(如 v0.8 的 preset_supplement 及未来新增)
			 * 一律保留——此前白名单式重建会静默抹掉面板不认识的键(审查 :567-584)。 */
			const { _note: _omitNote, ...curRest } = curCfg;
			const next = {
				...curRest,
				enabled: payload?.enabled !== false,
				autoDenyNew: payload?.autoDenyNew !== false,
				baseline_deny: Array.isArray(payload?.baseline_deny) ? payload.baseline_deny.map(String).filter(Boolean) : DEFAULT_BASELINE,
				preset_allow: (payload?.preset_allow && typeof payload.preset_allow === "object") ? payload.preset_allow : {},
				preset_extra_deny: (payload?.preset_extra_deny && typeof payload.preset_extra_deny === "object") ? payload.preset_extra_deny : {},
				/* [v0.4] main_deny 透传: payload 未给(旧面板保存)时保留现值, 不清空 */
				main_deny: Array.isArray(payload?.main_deny) ? payload.main_deny.map(String).filter(Boolean) : (Array.isArray(curCfg.main_deny) ? curCfg.main_deny : []),
				/* [v0.11] 主会话按角色两键透传(同 main_deny 模式: payload 未给→保留现值) */
					main_preset_allow: normPresetMap(payload?.main_preset_allow) ?? normPresetMap(curCfg.main_preset_allow) ?? {},
					main_preset_extra_deny: normPresetMap(payload?.main_preset_extra_deny) ?? normPresetMap(curCfg.main_preset_extra_deny) ?? {},
					/* [v0.9] preset_deny 透传(同 main_deny 模式) */
				preset_deny: Array.isArray(payload?.preset_deny) ? payload.preset_deny.map(String).filter(Boolean) : (Array.isArray(curCfg.preset_deny) ? curCfg.preset_deny : []),
				/* [v0.5] capabilities 透传(能力标签表, config 存在则整体覆盖内置):
				 * 显式传表→校验落盘; 显式传 null→恢复内置(清 config 键); 未给(键不存在)→保留现值 */
				...(payload && typeof payload === "object" && "capabilities" in payload
					? (payload.capabilities && typeof payload.capabilities === "object" && !Array.isArray(payload.capabilities)
						? { capabilities: Object.fromEntries(Object.entries(payload.capabilities)
							.filter(([, v]) => Array.isArray(v) && v.length > 0)
							.map(([k, v]) => [String(k).trim(), v.map(String).filter(Boolean)])) }
						: {})
					: (curCfg.capabilities && typeof curCfg.capabilities === "object" ? { capabilities: curCfg.capabilities } : {})),
			};
			mkdirSync(profileDir(), { recursive: true });
			atomicWrite(CFG_PATH(), JSON.stringify({ _note: "子代理工具面负面清单(dsh-depth-tool-gate)。baseline=depth>0 全裁; preset_allow=按 preset 豁免; preset_extra_deny=按 preset 加裁; main_deny=depth0 主会话显式裁(保护集兜底); autoDenyNew=lock 新见工具默认拦截; capabilities=能力标签表(dispatch_composed 动态面, 存在则整体覆盖内置, 删键恢复内置)。保存即生效(仅之后创建的 agent)。", ...next }, null, 1));
			/* 裁决权威=config: 保存后把 baseline 全员在 lock 建/标 seen(消 pending,
			 * 含此前不在 lock 的手动新加名——否则下个 syncLock 会误弹 pending) */
			const lock = readLock(); const now = new Date().toISOString();
			for (const n of next.baseline_deny) {
				if (lock.tools[n]) { lock.tools[n].state = "seen"; lock.tools[n].ruledAt = now; }
				else lock.tools[n] = { state: "seen", firstSeen: now, ruledAt: now };
			}
			lock.autoDenyNew = next.autoDenyNew;
			writeLock(lock);
			return { ok: true };
		} catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
	},
	/* 运行时快照 + lock 对账: 面板两栏(配置裁决面 vs 自动发现面)的数据源 */
	snapshot() {
		try {
			const snap = snapshotNames();
			const cfg = readConfig();
			const lock = readLock();
			if (!snap) return { ok: false, error: "tools 服务不可用(插件根 ctx 未就绪)" };
			const restrictable = new Set(snap.restrictable);
			const base = new Set(Array.isArray(cfg?.baseline_deny) ? cfg.baseline_deny : DEFAULT_BASELINE);
			const extraAll = new Set(Object.values(cfg?.preset_extra_deny || {}).flat());
			const ruled = [...restrictable].filter((n) => base.has(n) || extraAll.has(n));
			const undiscovered = snap.restrictable.filter((n) => !base.has(n) && !extraAll.has(n));
			const stale = [...base, ...extraAll].filter((n) => !restrictable.has(n) && !FORCED_NAMES.has(n));
			const pending = Object.entries(lock.tools).filter(([, r]) => r?.state === "pending").map(([n]) => n).filter((n) => restrictable.has(n));
			const forced = [...FORCED_NAMES];
			return { ok: true, ...snap, ruledCount: ruled.length, undiscovered, stale, pending, forced };
		} catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
	},
	/* [v0.9] usageStats: tool/call 频率(内存态, per-tool 总量 + per-preset 分桶)。
	 * 数据源=⑩ 采集器(session/event); top N 降序。 */
	usageStats(topN = 30) {
		const sortEntries = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
		const result = {
			ok: true,
			totalCalls: [...USAGE_TOTAL.values()].reduce((a, b) => a + b, 0),
			distinctTools: USAGE_TOTAL.size,
			top: sortEntries(USAGE_TOTAL).map(([name, count]) => ({ name, count })),
			byPreset: Object.fromEntries([...USAGE_BY_PRESET.entries()].map(([preset, m]) => [preset, {
				total: [...m.values()].reduce((a, b) => a + b, 0),
				top: sortEntries(m).map(([name, count]) => ({ name, count })),
			}])),
			/* [v0.11] 会话明细(按 last 倒序, 最近 40 个; id 只露后 8 位) */
			bySession: [...USAGE_BY_SESSION.values()].sort((a, b) => (b.last || "").localeCompare(a.last || "")).slice(0, 40)
				.map((s) => ({ id: s.id.length > 8 ? "…" + s.id.slice(-8) : s.id, preset: s.preset, total: s.total, first: s.first, last: s.last, top: [...s.tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })) })),
		};
		flushUsage(); /* 拉取即落盘(快照对齐用户所见); 原实现置于 return 之后=死码, 落盘从未生效 */
		return result;
	},
	/* pending 裁决: deny=入 config baseline(继承 preset 例外体系); allow=仅消 pending */
	rule(names, action) {
		try {
			const list = Array.isArray(names) ? names.map(String).filter(Boolean) : [String(names || "")].filter(Boolean);
			if (!list.length) return { ok: false, error: "names 为空" };
			if (action !== "deny" && action !== "allow") return { ok: false, error: "action 只认 deny|allow" };
			const cfg = readConfig() || {};
			const now = new Date().toISOString();
			if (action === "deny") {
				const base = new Set(Array.isArray(cfg.baseline_deny) ? cfg.baseline_deny : DEFAULT_BASELINE);
				for (const n of list) base.add(n);
				cfg.baseline_deny = [...base];
				cfg.enabled = cfg.enabled !== false; cfg.autoDenyNew = cfg.autoDenyNew !== false;
				mkdirSync(profileDir(), { recursive: true });
				atomicWrite(CFG_PATH(), JSON.stringify({ _note: "子代理工具面负面清单(dsh-depth-tool-gate)。baseline=depth>0 全裁; preset_allow=按 preset 豁免; preset_extra_deny=按 preset 加裁; main_deny=depth0 主会话显式裁(保护集兜底); autoDenyNew=lock 新见工具默认拦截。保存即生效(仅之后创建的 agent)。", ...cfg }, null, 1));
			} else {
				const base = new Set(Array.isArray(cfg.baseline_deny) ? cfg.baseline_deny : DEFAULT_BASELINE);
				const clash = list.filter((n) => base.has(n));
				if (clash.length) return { ok: false, error: `${clash.join(",")} 已在 baseline_deny 中——放行请走面板取消勾选(rule 只裁决 pending 新件)` };
			}
			const lock = readLock();
			for (const n of list) {
				if (lock.tools[n]) { lock.tools[n].state = "seen"; lock.tools[n].ruledAt = now; }
				else lock.tools[n] = { state: "seen", firstSeen: now, ruledAt: now };
			}
			writeLock(lock);
			log(`裁决 ${list.length} 件 → ${action}`);
			return { ok: true, ruled: list.length, action };
		} catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
	},
	/* lock 全文(面板闸门页签) */
	lockInfo() {
		const lock = readLock();
		return { ok: true, lock, forced: [...FORCED_NAMES], path: LOCK_PATH() };
	},
	recent(limit) {
		try {
			/* [v0.14.0 P2] 跨档读取: 当前档 + 归档档(归档不删历史)。 */
			const entries = readRecentAudit(limit);
			return { ok: true, entries, archive_dir: AUDIT_ARCHIVE_DIR };
		} catch (e) { return { ok: false, error: String((e && e.message) || e), entries: [] }; }
	},
};

export function apply(ctx) {
	ROOT_CTX = ctx;
	/* [v0.14.0 P0] 宿主 peer 解析(必须在 apply 内做: profileContext 此时才可取)。
	 * 失败 ⇒ **降级模式**: 裁剪/组装停用 + 台账记 peer-missing + 面板显示原因。
	 * 不抛(插件加载期崩溃会连累整个 profile), 但降级是 fail-loud 的: 面板与台账
	 * 都能看见"治理未生效", 不静默假装正常。 */
	try {
		const pc = ctx?.get?.("profileContext");
		/* 锚点键 = 本次 apply 的锚点组签名(按它键控, 不用单一模块级 bool ——
		 * 否则同模块实例下第二次 apply 会复用首次结果, 降级路径走不到)。 */
		PEER_KEY = anchorKey(pc ?? null);
		const pr = resolvePeers(pc ?? null);
		if (pr.ok) log(`宿主 peer 已就绪(${pr.anchor})`);
		else {
			warn("宿主 peer 解析失败 —— 治理降级(裁剪 fail-closed): " + pr.error);
			try { audit({ ts: new Date().toISOString(), ev: "peer-missing", severity: "fatal", scope: "plugin", err: String(pr.error).slice(0, 300) }); } catch { /* noop */ }
		}
	} catch (e) {
		PEER_KEY = null;
		warn("宿主 peer 解析异常 —— 治理降级: " + String((e && e.message) || e));
	}
	/* 频率快照载入: 必须在此处(而非模块加载期)——profileContext 此时才可取,
	 * 否则按缺省 profile 解析目录会读错文件(跨 profile 污染)。 */
	try { loadUsageSnapshot(); } catch { /* 载入失败已在内部告警 */ }
	/* [v0.14.0 P2] 启动即检查台账体积: 超阈值立即归档(不必等 64 次写才触发)。 */
	try { rotateAuditIfNeeded(); } catch { /* 归档失败已在内部告警 */ }

	/* usageStats 采集器: tool/call 频率统计。
	 * session/event 全局可达(同款模式): 全局 ctx.on 收所有会话(含子代)事件按
	 * subject 自筛。O(1) Map 计数, 只记工具名与次数, 不落 arguments(敏感 + 体积);
	 * 快照落盘, 重启不清零。 */
	ctx.effect(() => {
		const off = ctx.on("session/event", (session, event) => {
			try {
				if (event?.type !== "tool/call") return;
				let name = event?.data?.name;
				if (typeof name !== "string" || !name) return;
				if (!USAGE_TOTAL.has(name) && USAGE_TOTAL.size >= 4096) name = "__overflow__"; /* v0.9.1 键空间上限 */
USAGE_TOTAL.set(name, (USAGE_TOTAL.get(name) || 0) + 1);
				const h = session?.header;
				const preset = h?.agentPreset || ((h?.delegationDepth ?? 0) === 0 ? "__main__" : "?"); /* v0.9.1: 口径统一 undefined=0=主会话 */
				let m = USAGE_BY_PRESET.get(preset);
				if (!m) { m = new Map(); USAGE_BY_PRESET.set(preset, m); }
				m.set(name, (m.get(name) || 0) + 1);
				/* [v0.11] per-session 分桶(id 防御式取, cap 500 淘汰最旧; 每 500 次调用落盘) */
				const sid = String(session?.id || session?.header?.id || session?.header?.sessionId || "") || "?";
				let s = USAGE_BY_SESSION.get(sid);
				if (!s) {
					if (USAGE_BY_SESSION.size >= 500) {
						let ok = null, okLast = Infinity;
						for (const [k, v] of USAGE_BY_SESSION) if ((v.last || "").slice(0, 19) < String(okLast)) { ok = k; okLast = v.last || ""; }
						if (ok) USAGE_BY_SESSION.delete(ok);
					}
					s = { id: sid, preset, total: 0, first: new Date().toISOString(), last: "", tools: new Map() };
					USAGE_BY_SESSION.set(sid, s);
				}
				s.total++; s.last = new Date().toISOString(); if (!s.preset || s.preset === "?") s.preset = preset;
				s.tools.set(name, (s.tools.get(name) || 0) + 1);
				if (++USAGE_DIRTY >= 500) flushUsage();
			} catch { /* 采集绝不影响主流程 */ }
		});
		return () => { try { off?.(); } catch { /* noop */ } };
	}, "dsh-depth-tool-gate.usageCollector()");
	try { TOOLS = ctx.get("tools"); } catch (e) { warn("ctx.get(tools) 失败(插件空转, 不影响宿主): " + String((e && e.message) || e)); TOOLS = null; }
	ctx.effect(() => ctx.provide("depthToolGate", gateSvc), "dsh-depth-tool-gate.provideSvc()");

	/* ⑤ list_agent_presets: preset 能力目录(运行时注册表权威)——主会话按任务
	 *    选型 subagent preset 的枚举入口, 替代三代必漂移的文档清单。只读。 */
	ctx.effect(() => {
		try {
			const reg = registerTool(ctx, {
				name: "list_agent_presets",
				description: "枚举当前 DSH profile 已注册的全部 agent preset(id/name/description/order, 含默认标记)。用于按任务特征选型子代理角色(科研检索/生信/视觉/工头/办公/绘图等), 选定后经 preset_dispatch 的 preset 参数或 subagent 派单引用。数据=运行时注册表(权威, 随 preset 声明热更新); 未注册 ID 不在列。面板「子代理工具面」同源。",
				timeoutMs: undefined,
				parameters: { type: "object", properties: {} },
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (_a, value) => {
						try {
							const rows = (typeof value === "string" ? JSON.parse(value) : value)?.presets || [];
							return [{ type: "text", text: ["[agent preset 注册表] " + rows.length + " 个:", ...rows.map((p) => `  ${p.isDefault ? "★" : "·"} ${p.id}${p.name ? " — " + p.name : ""}${p.description ? "\n      " + p.description : ""}${p.broken ? "\n      ⚠broken: " + p.broken : ""}`)].join("\n") }];
						} catch (e) { return [{ type: "text", text: "[dsh-depth-tool-gate] preset render 失败: " + String(e) }]; }
					},
				},
				async execute() {
					/* remoteExportList() 本身返回 {presets:[...]}——不可再包一层,
					 * 否则 render 取 .presets 得对象 → rows.map TypeError */
					let svc = null;
					try { svc = ctx.get("agentPresets"); } catch { svc = null; }
					if (!svc || typeof svc.remoteExportList !== "function") {
						try { svc = ROOT_CTX?.get?.("agentPresets") ?? svc; } catch { /* keep */ }
					}
					if (svc && (typeof svc.remoteExportList === "function" || typeof svc.list === "function")) {
					/* 单次拉取(防双调用)+两分支统一过滤(防回退分支泄露)+失败显式报错 */
					let raw = null;
					try { raw = typeof svc.remoteExportList === "function" ? await svc.remoteExportList() : { presets: (await svc.list()).map((p) => ({ ...p, isDefault: false })) }; }
					catch (e) { return { error: "preset 注册表拉取失败: " + String((e && e.message) || e) }; }
					try {
						const denied = readConfig()?.preset_deny;
						if (Array.isArray(denied) && denied.length > 0) {
							const presets = (raw?.presets || []).filter((p) => !denied.includes(p.id));
							return { ...raw, presets, _note: `${denied.length} 个 preset 因 preset_deny 隐藏` };
						}
					} catch { /* 过滤失败=返回全量(降级) */ }
					return raw;
				}
					return { error: "agentPresets 服务不可用(注册表未挂载?)" };
				},
			}, "list_agent_presets");
			log("list_agent_presets 工具已注册(preset 能力目录)");
			return () => { try { reg?.dispose?.(); } catch { /* noop */ } };
		} catch (e) { warn("list_agent_presets 注册失败(枚举不可用, 裁剪不受影响): " + String((e && e.message) || e)); return () => {}; }
	}, "dsh-depth-tool-gate.presetLister()");

	/* ⑪ [v0.9] explain_gate: 只读诊断——解释当前 agent 的工具面治理状态
	 * (可见数/被裁名单+原因归因: baseline/main_deny/preset deny/lock pending)。
	 * 派单失败诊断与子代理自检入口; 自身不受所报闸门约束(只读)。 */
	ctx.effect(() => {
		try {
			const reg = registerTool(ctx, {
				name: "explain_gate",
				description: "只读解释当前 agent 的工具面治理: 返回可见工具数、被 dtg 裁掉的工具名与原因归因(baseline_deny/main_deny/preset deny/preset_allow 正面清单外/lock pending)。派单失败诊断、子代理自检、面板口径对账用。不修改任何状态。",
				timeoutMs: undefined,
				parameters: { type: "object", properties: {} },
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (_a, value) => {
						try {
							const v = typeof value === "string" ? JSON.parse(value) : value;
							const d = (v?.denied || []).slice(0, 20).map((d2) => `  ✂ ${d2.name} — ${d2.reason}`).join("\n");
							return [{ type: "text", text: `[explain_gate] 可见 ${v?.visibleCount ?? "?"}/${v?.restrictableCount ?? "?"} | 裁 ${v?.denied?.length ?? 0} 件\n${d || "  (无裁剪)"}` }];
						} catch (e) { return [{ type: "text", text: "[explain_gate] render 失败: " + String(e) }]; }
					},
				},
				async execute(_args, exec) {
					try {
						const agent = exec?.agent;
						if (!agent) return { error: "exec.agent 不可用" };
						const scoped = createScope(agent.ctx, agent);
						try {
							const tools = scoped.ctx.get("tools");
							if (!tools?.view) return { error: "tools 服务不可用" };
							const view = tools.view(agent);
							const visible = view?.visible;
							const restrictable = view?.restrictableNames;
							if (!visible || !restrictable) return { error: "view 不可用" };
							const cfg = readConfig();
							const lock = readLock();
							const header = agent?.session?.header;
							const depth = header?.delegationDepth ?? 0;
							const preset = header?.agentPreset || "";
							const base = new Set(Array.isArray(cfg?.baseline_deny) ? cfg.baseline_deny : DEFAULT_BASELINE);
							const mainDeny = new Set(Array.isArray(cfg?.main_deny) ? cfg.main_deny : []);
							const extra = new Set(Array.isArray(cfg?.preset_extra_deny?.[preset]) ? cfg.preset_extra_deny[preset] : []);
							const allowCfg = Array.isArray(cfg?.preset_allow?.[preset]) ? new Set(cfg.preset_allow[preset]) : null;
							const denied = [];
							for (const n of restrictable) {
								if (visible.has(n)) continue;
								let reason = "dtg-unknown";
								if (depth === 0 && mainDeny.has(n)) reason = "main_deny(主会话显式名单)";
								else if (depth > 0 && base.has(n)) reason = "baseline_deny(子代基线)";
								else if (depth > 0 && extra.has(n)) reason = `preset_extra_deny(${preset})`;
								else if (depth > 0 && allowCfg && !allowCfg.has(n)) reason = `preset_allow 正面清单外(${preset})`;
								else if (lock.tools[n]?.state === "pending") reason = "lock pending(新工具待裁决)";
								else if (lock.tools[n]?.state === "denied") reason = "lock denied(已裁决拒绝)";
								denied.push({ name: n, reason });
							}
							return {
								ok: true, depth, preset,
								visibleCount: visible.size, restrictableCount: restrictable.size,
								deniedCount: denied.length, denied,
							};
						} finally { try { scoped.dispose?.(); } catch { /* noop */ } }
					} catch (e) { return { error: String((e && e.message) || e) }; }
				},
			}, "explain_gate");
			log("explain_gate 工具已注册(工具面只读诊断)");
			return () => { try { reg?.dispose?.(); } catch { /* noop */ } };
		} catch (e) { warn("explain_gate 注册失败: " + String((e && e.message) || e)); return () => {}; }
	}, "dsh-depth-tool-gate.explainGate()");

	/* ⑨ [v0.4.2] dispatch_composed: 动态工具面组装派单(wrapper 工具)。
	 *    流程: 标签→allow 并集 → reserved childId 预挂 PENDING_CAPS →
	 *    subagents.startActivation(spawn) → agent/created 时 gateComposed 应用
	 *    restrict({allow}) → 等子代跑完返回其最终文本。API 形态照 workflow-ptc
	 *    startChild 先例(:330-348); exec.agent = 当前 agent(dsh-tools :338/:658)。 */
	ctx.effect(() => {
		try {
			const reg = registerTool(ctx, {
				name: "dispatch_composed",
				description: "按能力标签组装临时工具面并派生子代理执行任务(动态 preset)。capabilities 从配置标签表取(内置标签: literature=文献检索面/reader=轻读面/reader-lead=轻读面且可再派一级/literature-lead=文献检索面且可再派一级/ocr=图文提取面; 标签表可由 config.capabilities 整体覆盖, 以实际可用标签为准, 未知标签会直接报错并列出可用项); tools 直传显式工具名(与标签并集, 打补丁式追加)。子代理出生时只保留 allow 名单内工具, 面外一切不可见(含未来新工具)。适用于: 任务只需要一小片工具面、且没有现成细粒度 preset 的场景; 有现成 preset 时优先 preset 派单。\n并行派单: 传 tasks[] 数组(每项含自己的 prompt 与可选 capabilities/tools/description), 一次派出多个独立子代理 —— 各自工具面互不影响、互不等待, 同一轮里可并行跑多件任务; 顶层 prompt/capabilities/tools 作为各任务的默认值。单任务时用顶层 prompt。\n异步语义(默认): 本工具**立即返回**各子代理 id, 不等它们跑完; 各子代理完成时, 结果由宿主作为一条消息投递给本会话(与原生 subagent 工具同范式)。若需要当场拿到结果再继续, 传 wait=true(会等到全部完成, 期间本工具阻塞)。",
				timeoutMs: undefined,
				parameters: {
					type: "object",
					properties: {
						prompt: { type: "string", description: "派给子代理的完整自包含任务全文(单个任务时用)" },
						capabilities: { type: "array", items: { type: "string" }, description: "能力标签列表(可组合, 取并集; 与 tools 至少给其一)" },
						tools: { type: "array", items: { type: "string" }, description: "显式工具名直传(与能力标签并集; 名字须运行时可补挂, 未知名在补挂阶段丢弃并日志警示)" },
						description: { type: "string", description: "短标签(展示用, 如 '文献速查×3')" },
						tasks: {
							type: "array",
							description: "批量并行派单: 每项一个独立子代理(各自的 prompt/能力面), 一次发出、互不等待、互不影响。用于把多件同类任务并行交给子代理。",
							items: {
								type: "object",
								properties: {
									prompt: { type: "string", description: "该子代理的完整自包含任务全文" },
									capabilities: { type: "array", items: { type: "string" }, description: "该子代理的能力标签(不填则用顶层 capabilities)" },
									tools: { type: "array", items: { type: "string" }, description: "该子代理的直传工具名(不填则用顶层 tools)" },
									description: { type: "string", description: "该子代理的短标签" },
								},
								required: ["prompt"],
							},
						},
						wait: { type: "boolean", description: "批量派单后是否等待全部完成再返回(默认 false = 立即返回各子代理 id, 完成结果由宿主异步投递给本会话)" },
					},
					required: [],
				},
				output: {
					schema: { type: "object", additionalProperties: true },
					/* 渲染实现提到 composed-render.mjs —— host 与测试共用同一份真代码,
					 * 不再维护"同构副本"(旧形态实测会漂移: 改 host 不改副本 → 测试假绿)。 */
					render: (_a, value) => renderComposed(value, { dshHome: DSH_HOME }),
				},
				async execute(args, exec) {
					/* [v0.13.3] 出口净化: 宿主要求工具返回值必须是 lossless JSON
					 * (dsh-tools/lib/pipeline.js:797 → snapshotJsonValue → walkJsonValue:701,
					 *  任一属性值为 undefined/NaN ⇒ 整对象非法 ⇒ 宿主抛
					 *  「value is not lossless JSON」)。
					 * [v0.14.0 P1] 本层的净化已由**统一注册入口** registerTool() 兜住
					 * (四个工具全部经它注册, 出口自动净化)。此处保留本层是**双保险**:
					 * 本函数还可能被内部复用, 且它是历史上真实炸过的路径 —— 宁可多重
					 * 净化一次(幂等)也不要再赌一次宿主判定。
					 * 探针 scripts/probe-tool-returns.mjs 断言四个工具都在统一入口内。 */
					const out = await executeComposed(args, exec);
					const clean = toLossless(out);
					return clean === undefined ? { ok: false, error: "dispatch_composed 返回值无法净化" } : clean;
				},
			}, "dispatch_composed");
			log("dispatch_composed 工具已注册(动态工具面组装)");
			return () => { try { reg?.dispose?.(); } catch { /* noop */ } };
		} catch (e) { warn("dispatch_composed 注册失败(动态组装不可用, 裁剪不受影响): " + String((e && e.message) || e)); return () => {}; }
	}, "dsh-depth-tool-gate.composedDispatcher()");

	/* execute 的真实实现(独立函数, 便于出口统一净化)。 */
	async function executeComposed(args, exec) {
					try {
						const cfg = readConfig();
						if (cfg && cfg.enabled === false) return { ok: false, error: "dsh-depth-tool-gate 已禁用" };
						const capsTable = (cfg?.capabilities && typeof cfg.capabilities === "object" && Object.keys(cfg.capabilities).length) ? cfg.capabilities : DEFAULT_CAPABILITIES;
						let subagents = null;
						try { subagents = ctx.get("subagents"); } catch { subagents = null; }
						if (!subagents || typeof subagents.startActivation !== "function") {
							try { subagents = ROOT_CTX?.get?.("subagents") ?? subagents; } catch { /* keep */ }
						}
						if (!subagents || typeof subagents.startActivation !== "function") return { ok: false, error: "subagents 服务不可用(spawn 通道未挂载?)" };
						const parent = exec?.agent;
						if (!parent) return { ok: false, error: "exec.agent 不可用(无法定父)" };

						/* 任务清单: 批量(tasks[]) 或单任务(顶层 prompt/capabilities/tools)。
						 * 每项一个独立子代理 = 独立工具面 = 互不影响 = 可并行。 */
						const rawTasks = Array.isArray(args?.tasks) ? args.tasks : [];
						const specs = rawTasks.length
							? rawTasks.map((t, i) => ({
								prompt: String(t?.prompt ?? ""),
								tags: Array.isArray(t?.capabilities) ? t.capabilities.map(String).filter(Boolean)
									: (Array.isArray(args?.capabilities) ? args.capabilities.map(String).filter(Boolean) : []),
								extraTools: Array.isArray(t?.tools) ? t.tools.map(String).filter(Boolean)
									: (Array.isArray(args?.tools) ? args.tools.map(String).filter(Boolean) : []),
								label: String(t?.description || `任务${i + 1}`).slice(0, 48),
							}))
							: [{
								prompt: String(args?.prompt ?? ""),
								tags: Array.isArray(args?.capabilities) ? args.capabilities.map(String).filter(Boolean) : [],
								extraTools: Array.isArray(args?.tools) ? args.tools.map(String).filter(Boolean) : [],
								label: String(args?.description || "").slice(0, 48),
							}];

						/* 逐项算 allow 集(标签未知 → 硬失败, 整批不派) */
						/* [v0.13.4 P0-B] baseline 底线闸(入口层, fail-loud): 组装面命中
						 * baseline_deny 件 → 派发即报错点名标签与件名, 不静默剔除(静默会让
						 * 孙孙代莫名缺工具)。防: 含 dispatch_composed 权限的 lead 孙代经
						 * tools 直传/自定义标签使孙孙代合法获得 baseline 高危件(keep-only
						 * 放行 + 补挂双通道绕过, 2026-11 审计 P0-B)。
						 * dispatch_composed 单件豁免: 它是本通道级联机制(lead 标签 v0.4.7
						 * 设计, 生产 config baseline 含它 + lead 标签含它是并存现状), 豁免后
						 * 风险闭环 —— 孙代持有它也组不出任何 baseline 件(本闸 + gateComposed
						 * 兜底双拦)。baseline 以 readConfig 生效值为准, 勿硬编码常量。 */
						const baseSet = new Set(Array.isArray(cfg?.baseline_deny) ? cfg.baseline_deny : DEFAULT_BASELINE);
						baseSet.delete("dispatch_composed");
						const plans = [];
						for (const sp of specs) {
							if (!sp.tags.length && !sp.extraTools.length) return { ok: false, error: "capabilities 与 tools 至少给其一" };
							const allow = new Set();
							for (const t of sp.tags) {
								const list = capsTable[t];
								if (!Array.isArray(list)) return { ok: false, error: `未知能力标签: ${t}。可用: ${Object.keys(capsTable).join(", ")}` };
								for (const n of list) allow.add(n);
							}
							for (const n of sp.extraTools) allow.add(n);
							if (!sp.prompt.trim()) return { ok: false, error: "prompt 为空" };
							const violations = [];
							for (const t of sp.tags) {
								const hit = capsTable[t].filter((n) => baseSet.has(n));
								if (hit.length) violations.push(`标签 ${t} 含 [${hit.join(",")}]`);
							}
							const hitTools = sp.extraTools.filter((n) => baseSet.has(n));
							if (hitTools.length) violations.push(`tools 直传含 [${hitTools.join(",")}]`);
							if (violations.length) return { ok: false, error: `baseline_deny 是治理底线, 不接受 composed 组装 —— ${violations.join("; ")}` };
							plans.push({ ...sp, allow });
						}

						/* 逐项 spawn —— 各自独立预挂与独立面, 不互相等待。 */
						/* [v0.13.2] 派发时**快照**主会话的工具定义(补挂源):
						 * 旧形态在子代创建时读主会话**实时**面 → 主会话面一变(改 main_deny /
						 * pending 进件 / 新工具出现), 补挂就补不上 → 子代理面跟着漂移
						 * (台账实测同标签 literature-lead 的面在 23 与 25 之间跳)。
						 * 快照后: 已派出的子代理(含续派/冷恢复)都用这份快照补挂 → 面稳定。
						 * 快照失败不阻断派发(gateComposed 会回落实时面)。 */
						const snapDefs = captureMainToolDefs(parent, plans.map((p) => p.allow));
						const spawned = [];
						for (const plan of plans) {
							const childId = "dc-" + randomUUID();
							const label = String(plan.label || (plan.tags.length ? plan.tags.join("+") : `custom-${plan.extraTools.length}件`)).slice(0, 48);
							PENDING_CAPS.set(childId, { allow: plan.allow, label, expires: Date.now() + CAP_TTL_MS, defs: snapDefs, used: 0 });
							let run;
							try {
								run = await subagents.startActivation({
									provider: "spawn",
									childId,
									label: `composed:${label}`,
									/* [v0.13.2] delivery 改 "parent": 结果由宿主异步投递给本会话(与原生
									 * subagent 工具同范式 —— 它也是 "immediately returns its id, the
									 * runtime notifies you when it finishes"), 不再占用调用者等待
									 * → 同一轮里可连发多个子代理并行跑。原 "caller" 语义是
									 * "caller delivery only returns the result" → 必须 await 到结束,
									 * 串行的根因就在这里。 */
									delivery: "parent",
									signal: new AbortController().signal,
									request: {
										prompt: [{ type: "text", text: plan.prompt }],
										parent,
										/* 关键(v0.4.6): 绑空壳 dtg-shell(零工具行)——preset 工具行注册到子代 own 层,
										 * own 层不在 restrictableNames(dsh-tools view :497-505), 绑 cordis-sub
										 * 则其 tool 行永远裁不掉(面不精确); 空壳面=全局层×allow+补挂(精确),
										 * web/read 等定义经 gateComposed 从主会话 view 补挂。 */
										agentPreset: "dtg-shell",
										/* R1 缓解: allow 够不着 preset-scoped 名(subagent 系继承自父面),
										 * maxDepth 钉死到子代自身 depth → 意外级联被总闸拒。 */
										maxDepth: ((parent?.session?.header?.delegationDepth ?? 0) + 1) + (plan.allow.has("dispatch_composed") ? 1 : 0), /* v0.4.7: lead 面含 dispatch_composed 时+1 级联预算(总闸12仍管) */
									},
								});
							} catch (e) {
								PENDING_CAPS.delete(childId);
								spawned.push({ ok: false, label, error: "spawn 失败: " + String((e && e.message) || e) });
								continue;
							}
							if (run?.childId && run.childId !== childId) {
								/* reserved childId 未被采纳(后端语义漂移) → 迁移预挂并警示 */
								warn(`reserved childId 未采纳(=${String(run.childId).slice(0, 24)}), 迁移预挂`);
								const moved = PENDING_CAPS.get(childId); PENDING_CAPS.delete(childId);
								if (moved) PENDING_CAPS.set(run.childId, moved);
							}
							spawned.push({
								ok: true, childId: run?.childId || childId, label,
								capabilities: plan.tags, toolsExtra: plan.extraTools.length, allowed: plan.allow.size,
								run,
							});
						}

						const failed = spawned.filter((s) => !s.ok);
						const live = spawned.filter((s) => s.ok);
						/* 批量: 默认立即返回(并行), wait=true 才等全部完成 */
						const wantWait = args?.wait === true || (specs.length === 1 && args?.wait === true);
						if (wantWait && live.length) {
							const outs = [];
							for (const s of live) {
								try {
									const result = await s.run.result;
									const reply = Array.isArray(result?.output)
										? result.output.filter((b) => b?.type === "text").map((b) => b.text).join("")
										: "";
									/* [v0.13.3] 缺值一律**省略键**, 不写 undefined。
									 * 宿主 dsh-tools/lib/pipeline.js:797 snapshotToolValue →
									 * snapshotJsonValue → dsh-util-values walkJsonValue:701
									 * `if (typeof current !== "object") return void 0`
									 * ⇒ 任一属性值为 undefined ⇒ 整个对象快照失败 ⇒ 宿主抛
									 * 「value is not lossless JSON」(生产实测: wait=true 必炸,
									 *  非阻塞路径因为不写这些键而正常)。
									 * 探针 scripts/probe-lossless.mjs 用宿主真函数坐实:
									 *  undefined=非法 / 缺失键=合法 / null=合法。 */
									const o = { ...s, reply: reply || "(子代理无文本输出)" };
									delete o.run;
									if (result?.stopReason !== undefined && result?.stopReason !== null) o.stopReason = result.stopReason;
									outs.push(o);
								} catch (e) {
									const o = { ...s, ok: false, error: String((e && e.message) || e) };
									delete o.run;
									outs.push(o);
								} finally { try { await s.run?.dispose?.(); } catch { /* noop */ } }
							}
							return {
								ok: outs.every((o) => o.ok), batch: true, count: outs.length,
								/* 每个子项也走同一纪律: 只写有值的键 */
								dispatched: outs.map((o) => {
									const d = { childId: o.childId, label: o.label, capabilities: o.capabilities, allowed: o.allowed };
									if (o.stopReason !== undefined && o.stopReason !== null) d.stopReason = o.stopReason;
									if (o.reply !== undefined && o.reply !== null) d.reply = o.reply;
									if (o.error !== undefined && o.error !== null) d.error = o.error;
									return d;
								}),
							};
						}
						/* 非阻塞: 立即返回各子代理 id; 完成结果由宿主投递(delivery=parent) */
						return {
							ok: failed.length === 0, batch: specs.length > 1, count: spawned.length,
							async: true,
							dispatched: spawned.map((s) => s.ok
								? { childId: s.childId, label: s.label, capabilities: s.capabilities, toolsExtra: s.toolsExtra, allowed: s.allowed }
								: { label: s.label, error: s.error }),
							note: "已派出; 各子代理完成时结果由宿主投递给本会话(异步)。需要同步结果请再派一次并设 wait=true。",
						};
					} catch (e) {
						return { ok: false, error: String((e && e.message) || e) };
					}
	}

	/* goal 全周期守护自动化: 主会话 scope 注册同名 create_goal(shadow
	 * 全局官方版), 创建后自动写 armed-goals.json(durable 白名单)——免去手动
	 * set_goal_durable 补登记(goal 存活周期内都应守护)。
	 * 原逻辑=ctx.goals.create(execution.agent, {objective, maxGoalRounds})照抄官方;
	 * 自动登记=写 ~/.dsh/self-repair/armed-goals.json(与 set_goal_durable 工具同格式)。 */
	ctx.effect(() => {
		try {
			const reg = registerTool(ctx, {
				name: "create_goal",
				description: "Create a persisted goal that keeps this session working across automatic continuation rounds. Use it when the direct human request is a long-running objective, even if the user did not say \"goal\"; not for single-turn work. [dtg v0.4.4: 自动登记 durable 白名单, 重启后 self-repair-guard 自动 resume 续跑]",
				timeoutMs: undefined,
				parameters: {
					type: "object",
					properties: {
						objective: { type: "string", description: "The concrete completion objective inferred from the direct human request." },
						max_goal_rounds: { type: "number", description: "Optional positive safe-integer limit on automatic continuation rounds." },
					},
					required: ["objective"],
				},
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (_a, value) => {
						try {
							const v = typeof value === "string" ? JSON.parse(value) : value;
							const g = v?.goal;
							return [{ type: "text", text: `[create_goal ✓] ${g?.id || "?"} phase=${g?.phase || "?"} rounds=0/${g?.maxGoalRounds || "?"}${v?.autoDurable ? " [durable✓]" : ""}` }];
						} catch (e) { return [{ type: "text", text: "[create_goal] render 失败: " + String(e) }]; }
					},
				},
				async execute(args, exec) {
					try {
						const agent = exec?.agent;
						if (!agent) return { error: "exec.agent 不可用" };
						let goals = null;
						try { goals = ctx.get("goals"); } catch { goals = null; }
						if (!goals || typeof goals.create !== "function") {
							try { goals = ROOT_CTX?.get?.("goals") ?? goals; } catch { /* keep */ }
						}
						if (!goals || typeof goals.create !== "function") return { error: "goals 服务不可用" };
						const goal = goals.create(agent, {
							objective: args.objective,
							...args.max_goal_rounds !== void 0 ? { maxGoalRounds: args.max_goal_rounds } : {},
						});
						/* 自动 durable: 写 armed-goals.json(与 set_goal_durable 同格式) */
						let autoDurable = false;
						try {
							const armPath = join(DSH_HOME, "self-repair", "armed-goals.json");
							const armDir = join(DSH_HOME, "self-repair");
							mkdirSync(armDir, { recursive: true });
							let arm = { sessions: {}, version: 1, paused: {} };
							try { arm = JSON.parse(readFileSync(armPath, "utf8")); }
							catch (e) {
								/* [v0.8.4 P1 锚定] 坏/缺文件: 缺失=正常新建; 损坏=备份取证再新建,
								 * 不静默覆盖(旧路径会把既有白名单整表清丢)。 */
								if (existsSync(armPath)) {
									try { renameSync(armPath, armPath + ".corrupt-" + Date.now()); warn("armed-goals.json 损坏, 已备份取证后重建"); }
									catch { warn("armed-goals.json 损坏且备份失败: " + String((e && e.message) || e)); }
								}
							}
							arm.sessions = arm.sessions || {};
							arm.sessions[agent.id] = {
								goalId: goal.id,
								note: `auto-durable by dtg v0.4.4: ${String(args.objective).slice(0, 80)}`,
								addedAt: new Date().toISOString(),
							};
							atomicWrite(armPath, JSON.stringify(arm, null, 1));
							autoDurable = true;
							log(`goal 自动 durable: ${goal.id} → armed-goals.json`);
						} catch (e) {
							warn(`goal 自动 durable 失败(goal 已建, 白名单未写): ${String((e && e.message) || e)}`);
						}
						return { goal: { id: goal.id, revision: goal.revision ?? 1, objective: goal.objective, phase: goal.phase ?? "active", roundsStarted: 0, maxGoalRounds: goal.maxGoalRounds ?? args.max_goal_rounds ?? 10 }, activation: "armed", autoDurable };
					} catch (e) {
						return { error: String((e && e.message) || e) };
					}
				},
			}, "create_goal");
			log("create_goal 自动化已注册(durable 白名单自动登记)");
			return () => { try { reg?.dispose?.(); } catch { /* noop */ } };
		} catch (e) { warn("create_goal 自动化注册失败(goal 创建不受影响): " + String((e && e.message) || e)); return () => {}; }
	}, "dsh-depth-tool-gate.goalAutoDurable()");

	/* PENDING_CAPS 清扫(R4): 周期回收 TTL 过期条目(spawn 失败/abort 残留) */
	ctx.effect(() => {
		const timer = setInterval(() => {
			const now = Date.now();
			for (const [k, v] of PENDING_CAPS) if (v?.expires < now) PENDING_CAPS.delete(k);
		}, CAP_TTL_MS);
		return () => { clearInterval(timer); PENDING_CAPS.clear(); };
	}, "dsh-depth-tool-gate.capSweeper()");

	/* 主监听: agent/created = 任何 agent 诞生(新建/resume/spawn/fork/member) */
	ctx.effect(() => {
		ctx.on("agent/created", ({ agent }) => {
			gateAgent(agent);   /* 同步快速返回: serial 事件, 慢监听=会话创建卡死 */
		});
		ctx.on("agent/disposed", ({ agent }) => {
			const s = SCOPES.get(agent?.id);
			if (s) { SCOPES.delete(agent.id); try { s.dispose?.(); } catch { /* noop */ } }
		});
		log("agent/created 监听已挂(负面清单裁剪, 仅 depth>0; agent/disposed 回收 scope)");
		return () => {};
	}, "dsh-depth-tool-gate.onCreated");

	/* 面板数据面网关 */
	ctx.effect(() => {
		try {
			/* [v0.14.0 P0] 面板**始终挂载**。
			 * 初版是"peer 未就绪 ⇒ 不挂网关", 被盲审判为缺陷: 面板是唯一能让人
			 * 看见"治理没生效"的通道, 把它一起卸掉 = 自断观测通路
			 * (观测通道与失败源同源 ⇒ 降级静默不可见)。
			 * 现在: peer 在 ⇒ 用宿主那份 TypertRemoteService(同一实例);
			 *       peer 不在 ⇒ 用**兜底基类**(只提供面板读状态所需的最小面),
			 *       面板照样能打开并显示 degraded + 原因。
			 * 注: TypertRemoteService 继承自 Cordis Service, 兜底基类也继承 Service,
			 *     以免破坏 ctx.provide("depthToolGate") 之外的注册语义。 */
			const peers = PEER_KEY ? getPeers(PEER_KEY) : null;
			let Base;
			if (peers) {
				Base = peers.typert.TypertRemoteService;
			} else {
				warn("宿主 peer 未就绪 —— 面板改用兜底基类(治理降级, 面板仍可读状态)");
				/* 兜底基类: TypertRemoteService 继承自 Cordis Service(构造要 ctx.reflect.provide)。
				 * 这里不能凭空造一个"像 Service 的类" —— 宿主网关的 remote-methods 发现
				 * 依赖 Service 的注册语义。故兜底基类直接继承宿主那份 Cordis Service
				 * (从 dsh-typert-protocol 的依赖里拿不到时, 再退到最小实现)。 */
				Base = class FallbackRemoteService {
					constructor(c, serviceKey) {
						this.ctx = c;
						this.name = serviceKey;
						/* 尽力按 Cordis Service 的语义注册自己(宿主网关靠这个发现服务) */
						try { c?.reflect?.provide?.(serviceKey, this, undefined); } catch { /* 注册不了也不崩 */ }
					}
					dispose() { /* noop */ }
				};
			}
			class GateGateway extends Base {
				constructor(c) { super(c, "depthToolGateGw", { namespace: "depthToolGate" }); }
			}
			Object.defineProperty(GateGateway.prototype, "@deepseek-ai/dsh-typert-protocol/remote-methods", { value: { version: 1, methods: [
				{ method: "status", invocation: { kind: "direct" } },
				{ method: "save", invocation: { kind: "direct" } },
				{ method: "recent", invocation: { kind: "direct" } },
				{ method: "snapshot", invocation: { kind: "direct" } },
				{ method: "usageStats", invocation: { kind: "direct" } },
				{ method: "rule", invocation: { kind: "direct" } },
				{ method: "lockInfo", invocation: { kind: "direct" } },
			] } });
			const pick = () => { try { const s = ctx.get("depthToolGate"); if (s && typeof s.status === "function") return s; } catch { /* 回落闭包 */ } return gateSvc; };
			GateGateway.prototype.status = async () => { try { return pick().status(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
			/* wire 契约: 方法源码参数名 = wire 字段(shim-panel 10-12 事故教训) */
			GateGateway.prototype.save = async (payload) => { try { return pick().save(payload); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
			GateGateway.prototype.recent = async (limit) => { try { return pick().recent(limit); } catch (e) { return { ok: false, error: String((e && e.message) || e), entries: [] }; } };
			GateGateway.prototype.snapshot = async () => { try { return pick().snapshot(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
			GateGateway.prototype.usageStats = async () => { try { return pick().usageStats(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
			GateGateway.prototype.rule = async (names, action) => { try { return pick().rule(names, action); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
			GateGateway.prototype.lockInfo = async () => { try { return pick().lockInfo(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } };
			const gw = new GateGateway(ctx);
			log("remote 网关已挂载(depthToolGate → ctx.remote.depthToolGate)");
			return () => { try { if (typeof gw.dispose === "function") gw.dispose(); } catch { /* noop */ } };
		} catch (e) {
			console.error("[dsh-depth-tool-gate] 网关挂载失败(面板不可用, 裁剪本体不受影响):", e);
			return () => {};
		}
	}, "dsh-depth-tool-gate.gateway");
}
