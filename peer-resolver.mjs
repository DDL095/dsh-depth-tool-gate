/* peer-resolver.mjs — v0.14.0 P0: 宿主 peer 包的健壮解析
 *
 * ── 问题 ─────────────────────────────────────────────────────────────────
 * v0.13.x 静态裸名 import:
 *     import { createScope } from "@deepseek-ai/dsh-scope";
 *     import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
 * 静态 import 在**模块加载期**解析, 且解析锚点是**语句所在文件自身位置**
 * (Node ESM 语义), 不是 loader 的 baseUrl。于是:
 *   - 装在 ~/.dsh/profiles/web/node_modules/dsh-depth-tool-gate/ 的发布态:
 *     锚点上溯链里没有 @deepseek-ai/dsh-scope ⇒ ERR_MODULE_NOT_FOUND ⇒
 *     **整个插件加载失败**(npm 用户照 README 第一条命令装完即炸)。
 *   - 开发态(源仓自带 node_modules junction)恰好能跑 ⇒ 缺陷被本机掩盖。
 *
 * ── 修法 ─────────────────────────────────────────────────────────────────
 * 改用 createRequire(anchor) 动态取, 锚点优先级:
 *   ① profileContext.installAnchor —— 宿主 provide 的 DSH 本体 package.json
 *      绝对路径(profile-boot-e2mS45fC.js:295)。**这是权威锚点**: 从它解析到的
 *      @deepseek-ai/dsh-scope 与宿主 dsh-tools 侧解析到的是**同一物理文件**
 *      ⇒ require(esm) 与宿主 ESM import 共享同一模块实例 ⇒ kScope 单例。
 *   ② 插件自身位置(import.meta.url)—— 开发态/源仓形态(自带 junction)。
 *   ③ process.execPath 上溯 —— DSH 以 npx/全局方式启动时的兜底。
 *
 * ★ 为什么不能用"自带 peer 副本"来修:
 *   dsh-scope 的 kScope = Symbol("dsh.scope") 是**非注册 Symbol**(非 Symbol.for),
 *   两份实例 = 两个不同的 scope 标签 ⇒ 宿主 dsh-tools 的 scopeOf(this.ctx)
 *   读不到插件打的标签 ⇒ tools.restrict() 抛 "requires a scoped context"。
 *   即: 自带副本会把"加载失败"升级成"运行期裁剪全失效"(静默 fail-open), 更糟。
 *   故必须**复用宿主那一份**, 只能靠锚点解析, 不能靠自带。
 *
 * ── 失败姿态 ─────────────────────────────────────────────────────────────
 * 解析不到 ⇒ 不抛(插件加载期崩溃会连累整个 profile), 而是:
 *   resolvePeers() 返回 { ok:false, error } ⇒ 插件进入**降级模式**:
 *   裁剪/组装全部停用 + 台账记 peer-missing 事件 + 面板显示原因。
 *   降级是 fail-loud 的: 面板与台账都能看见"治理未生效", 不静默假装正常。
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* 需要从宿主取的两个包(都是宿主自带, 不随第三方插件分发)。 */
export const PEER_MODULES = ["@deepseek-ai/dsh-scope", "@deepseek-ai/dsh-typert-protocol"];

/* 解析结果与失败原因, **按 installAnchor 键控**缓存。
 *
 * ★ 为什么按锚点键控(而不是单一模块级变量): 盲审指出"单一模块级缓存在热重载 /
 *   重复 apply / 同进程多 profile 下会复用前一次的结果"。生产里单进程单 profile,
 *   单一缓存够用; 但一旦宿主支持热重载或多 profile 复用同进程, 单一缓存会把
 *   "第一个 profile 的成功结果"套用到第二个 profile —— 而第二个 profile 的锚点
 *   可能完全不同(甚至不可达), 于是**降级路径根本不会被走到**(静默按成功处理)。
 *   实测(A18 降级用例): 单一缓存 ⇒ 第二次挂载复用首次成功 ⇒ 降级日志为零 ⇒
 *   降级路径测不到。按锚点键控后, 不同锚点各判各的, 降级路径可被真实覆盖。
 */
let RESOLVED_BY_ANCHOR = new Map();   /* installAnchor(键) → {ok, anchor, modules} */
let LAST_ERROR = null;

/**
 * 收集候选锚点(按优先级)。
 * @param {object|null} profileContext - 宿主 provide 的 profileContext(含 installAnchor)。
 * @returns {Array<{label:string, path:string}>}
 */
export function collectAnchors(profileContext) {
	const out = [];
	const seen = new Set();
	const push = (label, p) => {
		if (typeof p !== "string" || !p) return;
		if (seen.has(p)) return;
		seen.add(p);
		out.push({ label, path: p });
	};
	/* ① 权威: 宿主 DSH 本体 package.json */
	try {
		const pc = profileContext;
		if (pc && typeof pc.installAnchor === "string") push("profileContext.installAnchor", pc.installAnchor);
	} catch { /* 服务未就绪 */ }
	/* ② 插件自身位置(开发态源仓自带 node_modules junction 时命中) */
	try {
		push("插件自身位置", fileURLToPath(import.meta.url));
	} catch { /* noop */ }
	/* ③ DSH 可执行文件上溯(npx/全局安装形态兜底) */
	try {
		if (process.execPath) push("process.execPath", process.execPath);
	} catch { /* noop */ }
	return out;
}

/**
 * 与**宿主侧参照实例**比对, 确认是同一份(而非"形状对但实例不同")。
 *
 * ★ 这是双实例风险的最终判据: dsh-scope 的 kScope = Symbol("dsh.scope") 是
 *   **非注册 Symbol**(非 Symbol.for) ⇒ 两份实例 = 两个不同的 scope 标签 ⇒
 *   宿主 dsh-tools 的 scopeOf(this.ctx) 读不到插件打的标签 ⇒
 *   tools.restrict() 抛 "requires a scoped context" ⇒ 裁剪**静默失效**(fail-open),
 *   比"加载失败"更糟(没人知道治理没生效)。
 *
 * 判据 = 函数引用同一性(createScope / scopeOf)。这不是形状检查, 而是**实例同一性**:
 *   同一物理文件 ⇒ require(esm) 与宿主 ESM import 共享同一模块实例 ⇒ 同一函数;
 *   两份副本 ⇒ 各自的模块实例 ⇒ 不同函数。已实测: 同一实例 ⇒ true。
 *
 * @param {object} scope - 候选 dsh-scope 模块。
 * @param {object|null} hostScope - 宿主侧参照(从宿主 dsh-tools 的位置解析出的那份)。
 * @returns {{ok:boolean, reason?:string}}
 */
export function verifySameInstance(scope, hostScope) {
	if (!hostScope || typeof hostScope.createScope !== "function") {
		/* 拿不到宿主参照 ⇒ 无法判定 ⇒ 明确记为"未验证", 不假装通过。 */
		return { ok: false, reason: "拿不到宿主侧参照实例, 无法验证实例同一性(双实例风险未排除)" };
	}
	if (scope?.createScope !== hostScope.createScope) {
		return { ok: false, reason: "与宿主不是同一实例(createScope 不同函数 ⇒ kScope 不同 ⇒ tools.restrict() 会抛 requires a scoped context)" };
	}
	if (scope?.scopeOf !== hostScope.scopeOf) {
		return { ok: false, reason: "scopeOf 与宿主不同函数 ⇒ scope 标签不互通" };
	}
	return { ok: true };
}

/**
 * 从一组锚点里解析 peer。
 * @param {Array<{label:string,path:string}>} anchors
 * @param {object|null} hostScope - 宿主侧参照实例。**省略时自动解析**
 *   (findHostScope) —— 否则不传就会因"无法验证实例同一性"而必然失败, 是个 footgun。
 * @returns {{ok:boolean, error?:string, anchor?:string, modules?:object}}
 */
export function resolveFromAnchors(anchors, hostScope = null) {
	const host = hostScope ?? findHostScope(anchors);
	const tried = [];
	for (const a of anchors) {
		try {
			if (!existsSync(a.path)) { tried.push(`${a.label}: 锚点不存在`); continue; }
			const req = createRequire(a.path);
			const scope = req(PEER_MODULES[0]);
			const typert = req(PEER_MODULES[1]);
			if (typeof scope?.createScope !== "function") { tried.push(`${a.label}: dsh-scope 无 createScope`); continue; }
			if (typeof typert?.TypertRemoteService !== "function") { tried.push(`${a.label}: dsh-typert-protocol 无 TypertRemoteService`); continue; }
			/* 实例同一性校验(与宿主参照比对, 见 verifySameInstance 顶部说明)。 */
			const same = verifySameInstance(scope, host);
			if (!same.ok) { tried.push(`${a.label}: ${same.reason}`); continue; }
			return { ok: true, anchor: `${a.label} → ${a.path}`, modules: { scope, typert } };
		} catch (e) {
			tried.push(`${a.label}: ${String((e && e.message) || e).split("\n")[0]}`);
		}
	}
	return { ok: false, error: `无法从宿主解析 peer 包(${PEER_MODULES.join(", ")})。尝试过: ${tried.join(" | ")}` };
}

/**
 * 取宿主侧参照实例(从宿主 dsh-tools 的位置解析出的 dsh-scope)。
 * 用于 verifySameInstance 比对 —— 没有它就无法证明"我们拿到的是宿主那一份"。
 * @param {Array<{label:string,path:string}>} anchors
 * @returns {object|null}
 */
export function findHostScope(anchors) {
	for (const a of anchors) {
		try {
			if (!existsSync(a.path)) continue;
			/* 宿主 dsh-tools 的位置: <dsh>/node_modules/@deepseek-ai/dsh-tools/package.json
			 * 其中 <dsh> = dirname(锚点) —— 锚点是 DSH 本体的 package.json(绝对路径)。 */
			const dshDir = dirname(a.path);
			const hostToolsPkg = join(dshDir, "node_modules", "@deepseek-ai", "dsh-tools", "package.json");
			if (!existsSync(hostToolsPkg)) continue;
			const hostReq = createRequire(hostToolsPkg);
			const hostScope = hostReq(PEER_MODULES[0]);
			if (typeof hostScope?.createScope === "function") return hostScope;
		} catch { /* 试下一个锚点 */ }
	}
	return null;
}

/**
 * 解析并缓存 peer(幂等)。必须在 apply(ctx) 里调用(ctx 提供 profileContext)。
 * @param {object|null} profileContext
 * @returns {{ok:boolean, error?:string, anchor?:string, modules?:object}}
 */
/**
 * 锚点键(缓存键): 由锚点组签名而来。
 * @param {object|null} profileContext
 * @returns {string}
 */
export function anchorKey(profileContext) {
	return collectAnchors(profileContext).map((a) => a.path).join("|");
}

/**
 * 解析并缓存 peer(幂等)。必须在 apply(ctx) 里调用(ctx 提供 profileContext)。
 * @param {object|null} profileContext
 * @returns {{ok:boolean, error?:string, anchor?:string, modules?:object}}
 */
export function resolvePeers(profileContext) {
	/* 键 = 权威锚点(installAnchor); 没有就用整组锚点的签名当键。 */
	const anchors = collectAnchors(profileContext);
	const key = anchors.map((a) => a.path).join("|");
	if (RESOLVED_BY_ANCHOR.has(key)) return RESOLVED_BY_ANCHOR.get(key);
	const r = resolveFromAnchors(anchors);
	RESOLVED_BY_ANCHOR.set(key, r);
	if (!r.ok) LAST_ERROR = r.error;
	return r;
}

/**
 * 取已解析的 peer; 未解析返回 null。
 * @param {string|null} key - resolvePeers 用的锚点键(省略则取最后一次成功结果)。
 */
export function getPeers(key = null) {
	if (key !== null) {
		const hit = RESOLVED_BY_ANCHOR.get(key);
		return hit && hit.ok ? hit.modules : null;
	}
	/* 无键: 取最近一次成功的(modules 非空者)。 */
	for (const v of RESOLVED_BY_ANCHOR.values()) if (v?.ok) return v.modules;
	return null;
}

/** 上次解析失败的原因(未失败则 null)。 */
export function peerError() {
	return LAST_ERROR;
}

/** 仅供测试: 清缓存。 */
export function __resetPeerCache() {
	RESOLVED_BY_ANCHOR = new Map();
	LAST_ERROR = null;
}
