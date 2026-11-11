/* dtg-role-brief — 域子代 per-role 定制引导(替代全量 AGENTS.md 注入)
 *
 * 背景(源码定案): agent-instructions 的 user-global 层(~/.dsh/AGENTS.md)无条件加载
 * 且无 config 开关, candidates 只管 project 层; 域 preset 瘦身唯一正路 = preset 段
 * 删除 agent-instructions 行(源头断供), 引导内容改由本模块以 systemPrompt section
 * 注入(与 prompt-slim 同机制同 API)。
 *
 * 用法: preset 段 plugins 行挂本模块并传行内 config(经 apply(ctx, config) 第二参直传):
 *   - id: dtg-role-brief
 *     path: <bundle 内 role-briefs.mjs>
 *     config: { brief: "sci-worker" }
 * 注入文本 = agents-briefs/_common.md(通用铁律) + agents-briefs/<brief>.md(角色专属),
 * 段名 role-brief:<brief>(per-role 命名, provenance_audit 可按角色归因字节数)。
 *
 * briefs 目录 = 本文件所在目录的 agents-briefs/; brief 值仅允许纯文件名
 * (拒绝路径分隔符, 与官方 resolveInstructionFileCandidates 同过滤口径)。
 * 文件缺失/无 config 时 warn 并跳过(不阻断会话, 引导缺位优于会话失败)。 */
export const name = "dtg-role-brief";
export const inject = ["systemPrompt"];

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const BRIEFS_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents-briefs");

/* v0.8.2 缺失可见化(§7.5 修复尾步): 静默降级是发布即炸的最难诊断形态——
 * warn 之外同步记 dtg 台账(面板「台账」Tab 与 agent 问答均可查), 事件类型
 * role-brief-missing; 写失败静默(台账是尽力而为, 不阻断引导主流程)。 */
function logAudit(detail) {
	try {
		const dir = join(DSH_HOME, "logs", "depth-tool-gate");
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "audit.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ev: "role-brief-missing", ...detail }) + "\n");
	} catch { /* best-effort */ }
}

function readBrief(file) {
	try {
		return readFileSync(join(BRIEFS_DIR, file), "utf8").trim();
	} catch {
		return void 0;
	}
}

export function apply(ctx, config) {
	const brief = typeof config === "object" && config !== null ? config.brief : void 0;
	if (typeof brief !== "string" || !brief || /[\\/]/.test(brief)) {
		console.warn(`[dtg-role-brief] 无效 brief 配置(${String(brief)})——跳过注入`);
		return () => {};
	}
	const common = readBrief("_common.md");
	const role = readBrief(`${brief}.md`);
	if (common === void 0 && role === void 0) {
		console.warn(`[dtg-role-brief] agents-briefs/ 下既无 _common.md 也无 ${brief}.md——跳过注入`);
		logAudit({ brief, reason: "both-missing", impact: "子代无 role 引导(静默降级, 已可见化)" });
		return () => {};
	}
	const text = [common, role].filter((s) => s !== void 0).join("\n\n");
	const sp = ctx.get("systemPrompt");
	if (!sp || typeof sp.section !== "function") {
		console.warn("[dtg-role-brief] systemPrompt 服务不可用——跳过注入(子代将无 role 引导)");
		return () => {};
	}
	let disposer;
	try {
		disposer = sp.section({ name: `role-brief:${brief}`, order: 650, text });
	} catch (e) {
		console.warn(`[dtg-role-brief] section 注入失败(${brief}): ${String((e && e.message) || e)}`);
		logAudit({ brief, reason: "section-failed", error: String((e && e.message) || e) });
		return () => {};
	}
	console.log(`[dtg-role-brief] 已注入 ${brief} 引导(_common${role === void 0 ? "" : "+" + brief} 共 ${text.length}B)`);
	/* v0.7.1 正面清单自治理: 手开会话的 header.agentPreset=创建时默认值(UI select
	 * 不回写), dtg gateMain 按 header 判身份对手开会话恒错——身份与裁剪同源解决:
	 * 本插件天然知道 brief 身份, 行集激活时读 config.preset_allow[brief] 直接
	 * restrict({allow})。delegation 子代仍由 gateChild 兜底(豁免制), 本处幂等。 */
	try {
		const tools = ctx.get("tools");
		if (tools && typeof tools.restrict === "function" && typeof tools.view === "function") {
			let allow = null;
			try {
				/* 配置目录按当前 profile 解析(与 host 同一口径): profileContext.dir 优先,
				 * 缺省回落 profiles/web —— 避免 desktop/headless 等 profile 读错 profile 的策略。 */
				let pdir = join(DSH_HOME, "profiles", "web");
				try { const pc = ctx.get?.("profileContext"); if (pc && typeof pc.dir === "string" && pc.dir) pdir = pc.dir; } catch { /* 服务不可得→回落 */ }
				const cfg = JSON.parse(readFileSync(join(pdir, "depth-tool-gate.config.json"), "utf8"));
				const list = cfg?.preset_allow?.[brief];
				if (Array.isArray(list) && list.length) allow = [...new Set(list)];
			} catch { /* config 读不到→不自治理(交 dtg 路径) */ }
			if (allow) {
				/* 初筛: 无参 view=纯全局层可裁名(allow 名单基本全是全局行工具);
				 * restrict 内部还会按 scoped known 复核, 未知名 throw→catch 降级 warn */
				const known = tools.view()?.restrictableNames;
				const applicable = known ? allow.filter((n) => known.has(n)) : allow;
				if (applicable.length > 0) {
					tools.restrict({ allow: applicable });
					console.log(`[dtg-role-brief] 已自治理 ${brief} 工具面(正面清单 ${applicable.length}/${allow.length} 件)`);
				}
			}
		}
	} catch (e) {
		console.warn(`[dtg-role-brief] 自治理跳过(${brief}): ${String((e && e.message) || e)}`);
	}
	return () => {
		try {
			if (disposer && typeof disposer === "function") disposer();
			else disposer?.dispose?.();
		} catch { /* noop */ }
	};
}
