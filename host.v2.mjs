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
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
/* [v0.8.2 P1/P2 修复] 原绝对 file-URL import (指向本机 npm 全局目录, 非本机必炸
 * ERR_MODULE_NOT_FOUND, 发布导出器 A1 拦截项) → 裸包名主入口; 开发态经本仓
 * node_modules/@deepseek-ai/ junction 解析(指回 dsh 主包, 同 dsh-tool-subagent-fork
 * 方案), 发布态由宿主 loader 的 profile scope 解析。 */
import { TypertRemoteService as __TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createScope } from "@deepseek-ai/dsh-scope";

/* tools = 全局单例服务(在插件根取一次): restrict/view 在**服务**上, 作用域由
 * createScope(agent.ctx, agent) 构造; agent.ctx.get("tools") 可能撞 scope 隔离
 * 返回 undefined → 永久 no-op, 故不采用。 */
let TOOLS = null;
let ROOT_CTX = null;            /* apply 时留存: snapshot 临时 scope 与 agentPresets 读取用 */
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
const NAME = "dsh-depth-tool-gate";

/* preset-scoped 组名: 由 preset 内 tool-subagent 行注册, 不在全局 restrictableNames
 * 内, tools.restrict() 够不着(0.2.1/0.2.2 实测)。深度由 maxDepth=12 总闸管。 */
const FORCED_NAMES = new Set(["subagent", "subagent_fork"]);

/* [v0.4.2] dispatch_composed: reserved childId → allow 名单中转仓。
 * TTL = spawn→agent/created 正常时延(<5s)加裕量; 残留(spawn 失败/abort)由清扫回收。 */
const PENDING_CAPS = new Map();  /* childId → {allow:Set<string>, label, expires} */
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

function audit(record) {
	try {
		mkdirSync(AUDIT_DIR, { recursive: true });
		appendFileSync(AUDIT_PATH, JSON.stringify(record) + "\n", "utf8");
	} catch (e) { warn("台账写入失败(裁剪已生效): " + String((e && e.message) || e)); }
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
		const allowList = [...cap.allow].filter((n) => known.has(n));
		const dropped = cap.allow.size - allowList.length;
		/* ① 裁继承层: keep-only(allowList 允许为空=裁光全局层, 面全靠补挂) */
		tools.restrict({ allow: allowList });
		/* ② 补挂: 不在可裁集的目标名(preset 行工具), 从主会话 view 取定义注册到
		 * 子代 own 层(豁免 restrictions, 直接 visible)。 */
		const supplemented = [];
		let mainView = null;
		if (mainAgent) { try { mainView = tools.view(mainAgent); } catch (e) { warn(`主会话 view 失败: ${String((e && e.message) || e)}`); } }
		for (const name of cap.allow) {
			if (known.has(name)) continue; /* 已在可裁集, restrict 已保留 */
			try {
				const def = mainView?.visible?.get(name) || mainView?.registrations?.get(name)?.definition;
				if (def) {
					tools.register(def); /* 注册到子代 own 层(scopeOf(sctx)=agent) */
					supplemented.push(name);
				} else {
					warn(`composed 补挂无定义(${name}): 主会话面也没有 —— 弃(面外)`);
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
			droppedUnknown: dropped, visibleAfter, knownCount: known.size,
			supplemented: supplemented.length, supplementedNames: supplemented,
		};
		audit(rec);
		log(`composed 裁剪: ${agent.id.slice(0, 24)} 面标签=${cap.label} allow=${allowList.length}/${known.size}(可裁)+补挂${supplemented.length} 面=${rec.visibleAfter}${dropped ? ` 丢弃未知=${dropped}` : ""}`);
		return rec;
	} catch (e) {
		PENDING_CAPS.delete(agent?.id);
		warn(`composed 裁剪异常(${agent?.id}, 退常规): ${String((e && e.message) || e)}`);
		return { error: String((e && e.message) || e) };
	}
}

/* ── 核心裁剪: 同步、纯内存+偶发小文件、微秒~毫秒级(agent/created serial 事件不可阻塞) ── */
function gateAgent(agent) {
	try {
		const header = agent?.session?.header;
		const depth = header?.delegationDepth ?? 0;
		if (depth <= 0) return gateMain(agent); /* [v0.4] depth0 也过闸(main_deny 显式名单) */
		const cap = PENDING_CAPS.get(agent?.id);
		log(`[composed-debug] agent.id=${agent?.id} PENDING_CAPS.size=${PENDING_CAPS.size} keys=${[...PENDING_CAPS.keys()].map(k=>k.slice(0,12)).join(",")} hit=${!!cap}`);
		if (cap) {
			PENDING_CAPS.delete(agent.id);
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
 * 临时 scope 取 depth-0 视角的 restrictableNames(全局行+host 插件行, 不含
 * preset-scoped 名); 即取即弃, disposer 随临时 scope 回收, 不留 restriction。 */
function snapshotNames() {
	if (!ROOT_CTX || !TOOLS) return null;
	const key = { id: "__dtg_snapshot__" };
	const scoped = createScope(ROOT_CTX, key);
	try {
		const sctx = scoped.ctx;
		const tools = sctx.get("tools") || TOOLS;
		const view = tools.view(sctx);
		return { restrictable: [...view.restrictableNames].sort(), visibleCount: view.visible?.size ?? null, ts: new Date().toISOString() };
	} catch (e) {
		warn("snapshot 失败: " + String((e && e.message) || e));
		return null;
	} finally { try { scoped.dispose?.(); } catch { /* noop */ } }
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
			if (!existsSync(AUDIT_PATH)) return { ok: true, entries: [] };
			const lines = readFileSync(AUDIT_PATH, "utf8").split("\n").filter(Boolean);
			const n = Math.max(1, Math.min(200, Number(limit) || 30));
			const entries = lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
			return { ok: true, entries };
		} catch (e) { return { ok: false, error: String((e && e.message) || e), entries: [] }; }
	},
};

export function apply(ctx) {
	ROOT_CTX = ctx;
	/* 频率快照载入: 必须在此处(而非模块加载期)——profileContext 此时才可取,
	 * 否则按缺省 profile 解析目录会读错文件(跨 profile 污染)。 */
	try { loadUsageSnapshot(); } catch { /* 载入失败已在内部告警 */ }

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
			const reg = ctx.tools.register({
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
			});
			log("list_agent_presets 工具已注册(preset 能力目录)");
			return () => { try { reg?.dispose?.(); } catch { /* noop */ } };
		} catch (e) { warn("list_agent_presets 注册失败(枚举不可用, 裁剪不受影响): " + String((e && e.message) || e)); return () => {}; }
	}, "dsh-depth-tool-gate.presetLister()");

	/* ⑪ [v0.9] explain_gate: 只读诊断——解释当前 agent 的工具面治理状态
	 * (可见数/被裁名单+原因归因: baseline/main_deny/preset deny/lock pending)。
	 * 派单失败诊断与子代理自检入口; 自身不受所报闸门约束(只读)。 */
	ctx.effect(() => {
		try {
			const reg = ctx.tools.register({
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
			});
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
			const reg = ctx.tools.register({
				name: "dispatch_composed",
				description: "按能力标签组装临时工具面并派生子代理执行任务(动态 preset)。capabilities 从配置标签表取(内置标签: literature=文献检索面/reader=轻读面/reader-lead=轻读面且可再派一级/literature-lead=文献检索面且可再派一级/ocr=图文提取面; 标签表可由 config.capabilities 整体覆盖, 以实际可用标签为准, 未知标签会直接报错并列出可用项); tools 直传显式工具名(与标签并集, 打补丁式追加)。子代理出生时只保留 allow 名单内工具, 面外一切不可见(含未来新工具)。适用于: 任务只需要一小片工具面、且没有现成细粒度 preset 的场景; 有现成 preset 时优先 preset 派单。等待子代理完成并返回其最终回复文本。",
				timeoutMs: undefined,
				parameters: {
					type: "object",
					properties: {
						prompt: { type: "string", description: "派给子代理的完整自包含任务全文" },
						capabilities: { type: "array", items: { type: "string" }, description: "能力标签列表(可组合, 取并集; 与 tools 至少给其一)" },
						tools: { type: "array", items: { type: "string" }, description: "显式工具名直传(与能力标签并集; 名字须运行时可补挂, 未知名在补挂阶段丢弃并日志警示)" },
						description: { type: "string", description: "短标签(展示用, 如 '文献速查×3')" },
					},
					required: ["prompt"],
				},
				output: {
					schema: { type: "object", additionalProperties: true },
					render: (_a, value) => {
						try {
							const v = typeof value === "string" ? JSON.parse(value) : value;
							const head = `[dispatch_composed ${v?.ok ? "✓" : "✗"}] 面=${(v?.capabilities || []).join("+") || "custom"}${v?.toolsExtra ? `+直传${v.toolsExtra}件` : ""} allow=${v?.allowed ?? "-"}${v?.droppedUnknown ? ` 丢弃未知=${v.droppedUnknown}` : ""}`;
							if (v?.error) return [{ type: "text", text: head + "\n错误: " + v.error }];
							const full = String(v?.reply || "");
							const CAP = 65536;
							if (full.length <= CAP) return [{ type: "text", text: head + "\n" + full }];
							/* 超长兜底: 全文落盘, 回执带路径(信息能力不因截断丢失) */
							let spill = "";
							try {
								const dir = join(DSH_HOME, "logs", "dsh-depth-tool-gate", "spill");
								mkdirSync(dir, { recursive: true });
								const file = join(dir, `composed-reply-${Date.now()}.md`);
								writeFileSync(file, full, "utf8");
								spill = `\n[全文 ${full.length} 字符超回执上限 ${CAP}, 已完整落盘: ${file}]`;
							} catch { spill = `\n[全文 ${full.length} 字符超回执上限 ${CAP}, 落盘失败——用 tool_result_index/read_tool_result 按 callId 读回完整原文]`; }
							return [{ type: "text", text: head + spill + "\n" + full.slice(0, CAP) }];
						} catch (e) { return [{ type: "text", text: "[dispatch_composed] render 失败: " + String(e) }]; }
					},
				},
				async execute(args, exec) {
					try {
						const cfg = readConfig();
						if (cfg && cfg.enabled === false) return { ok: false, error: "dsh-depth-tool-gate 已禁用" };
						const capsTable = (cfg?.capabilities && typeof cfg.capabilities === "object" && Object.keys(cfg.capabilities).length) ? cfg.capabilities : DEFAULT_CAPABILITIES;
						const tags = Array.isArray(args?.capabilities) ? args.capabilities.map(String).filter(Boolean) : [];
						const extraTools = Array.isArray(args?.tools) ? args.tools.map(String).filter(Boolean) : [];
						if (!tags.length && !extraTools.length) return { ok: false, error: "capabilities 与 tools 至少给其一" };
						const allow = new Set();
						for (const t of tags) {
							const list = capsTable[t];
							if (!Array.isArray(list)) return { ok: false, error: `未知能力标签: ${t}。可用: ${Object.keys(capsTable).join(", ")}` };
							for (const n of list) allow.add(n);
						}
						for (const n of extraTools) allow.add(n);
						if (typeof args?.prompt !== "string" || !args.prompt.trim()) return { ok: false, error: "prompt 为空" };
						let subagents = null;
						try { subagents = ctx.get("subagents"); } catch { subagents = null; }
						if (!subagents || typeof subagents.startActivation !== "function") {
							try { subagents = ROOT_CTX?.get?.("subagents") ?? subagents; } catch { /* keep */ }
						}
						if (!subagents || typeof subagents.startActivation !== "function") return { ok: false, error: "subagents 服务不可用(spawn 通道未挂载?)" };
						const parent = exec?.agent;
						if (!parent) return { ok: false, error: "exec.agent 不可用(无法定父)" };
						/* reserved childId: 于此预挂 → agent/created 时 gateComposed 按 agent.id 认领 */
						const childId = "dc-" + randomUUID();
						const label = String(args?.description || (tags.length ? tags.join("+") : `custom-${extraTools.length}件`)).slice(0, 48);
						PENDING_CAPS.set(childId, { allow, label, expires: Date.now() + CAP_TTL_MS });
						let run;
						try {
							run = await subagents.startActivation({
								provider: "spawn",
								childId,
								label: `composed:${label}`,
								delivery: "caller",
								signal: new AbortController().signal,
								request: {
									prompt: [{ type: "text", text: args.prompt }],
									parent,
									/* 关键(v0.4.6): 绑空壳 dtg-shell(零工具行)——preset 工具行注册到子代 own 层,
									 * own 层不在 restrictableNames(dsh-tools view :497-505), 绑 cordis-sub
									 * 则其 tool 行永远裁不掉(面不精确); 空壳面=全局层×allow+补挂(精确),
									 * web/read 等定义经 gateComposed 从主会话 view 补挂。 */
									agentPreset: "dtg-shell",
									/* R1 缓解: allow 够不着 preset-scoped 名(subagent 系继承自父面),
									 * maxDepth 钉死到子代自身 depth → 意外级联被总闸拒。 */
									maxDepth: ((parent?.session?.header?.delegationDepth ?? 0) + 1) + (allow.has("dispatch_composed") ? 1 : 0), /* v0.4.7: lead 面含 dispatch_composed 时+1 级联预算(总闸12仍管) */
								},
							});
						} catch (e) {
							PENDING_CAPS.delete(childId);
							return { ok: false, error: "spawn 失败: " + String((e && e.message) || e) };
						}
						if (run?.childId && run.childId !== childId) {
							/* reserved childId 未被采纳(后端语义漂移) → 迁移预挂并警示 */
							warn(`reserved childId 未采纳(=${String(run.childId).slice(0, 24)}), 迁移预挂`);
							const moved = PENDING_CAPS.get(childId); PENDING_CAPS.delete(childId);
							if (moved) PENDING_CAPS.set(run.childId, moved);
						}
						try {
							const result = await run.result;
							const reply = Array.isArray(result?.output)
								? result.output.filter((b) => b?.type === "text").map((b) => b.text).join("")
								: "";
							return {
								ok: result?.stopReason === "completed", stopReason: result?.stopReason,
								childId: run.childId, capabilities: tags, toolsExtra: extraTools.length, allowed: allow.size,
								reply: reply || "(子代理无文本输出)",
							};
						} finally { try { await run.dispose?.(); } catch { /* noop */ } }
					} catch (e) {
						return { ok: false, error: String((e && e.message) || e) };
					}
				},
			});
			log("dispatch_composed 工具已注册(动态工具面组装)");
			return () => { try { reg?.dispose?.(); } catch { /* noop */ } };
		} catch (e) { warn("dispatch_composed 注册失败(动态组装不可用, 裁剪不受影响): " + String((e && e.message) || e)); return () => {}; }
	}, "dsh-depth-tool-gate.composedDispatcher()");

	/* goal 全周期守护自动化: 主会话 scope 注册同名 create_goal(shadow
	 * 全局官方版), 创建后自动写 armed-goals.json(durable 白名单)——免去手动
	 * set_goal_durable 补登记(goal 存活周期内都应守护)。
	 * 原逻辑=ctx.goals.create(execution.agent, {objective, maxGoalRounds})照抄官方;
	 * 自动登记=写 ~/.dsh/self-repair/armed-goals.json(与 set_goal_durable 工具同格式)。 */
	ctx.effect(() => {
		try {
			const reg = ctx.tools.register({
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
			});
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
			class GateGateway extends __TypertRemoteService {
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
