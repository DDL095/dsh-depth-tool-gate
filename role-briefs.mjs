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
/* ★ 注入清单**不含 profileContext**(实测权衡, 2026-11-15):
 *   目录文本若要动态取 config.capabilities, 需 ctx.get("profileContext")。
 *   但该服务**可能不存在**(宿主 dsh-app-boot:3099 有 `=== void 0` 分支)⇒
 *   写进 inject 会让本插件在服务缺席时**加载失败** ⇒ 挂它的 6+ 个 preset
 *   全部失去岗位引导 —— 正是 v0.8.2 专门治理过的静默降级故障。
 *   ⇒ 改为**软探测**(ctx.get 带 try/catch, 取不到就跳过目录注入, brief 仍在)。 */
export const inject = ["systemPrompt"];

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
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

/* ── [v0.16.0 §2] 能力标签目录(决策面用) ──────────────────────────────────
 * 数据源 = host 侧生成的落盘文件(单一真相源; 生成逻辑不复制到本模块,
 * 否则两处会漂移 —— 本仓同类教训见 versions.md 的「模块化组织」条目)。
 *
 * ★ 为什么目录是**落盘**而不是即时计算:
 *   ① role-briefs 不该自己解析 config.capabilities(那是 host 的通道语义);
 *   ② host 侧算目录时**已经**持有生效配置(读的是同一个 readConfig());
 *   ③ 落盘 = 可被探针直接断言字节数(判别力)。
 *
 * ★ 落盘路径: profile 目录(与 config/lock 同级), 文件名不起插件前缀
 *   (同 host 侧 origin.json 的理由: 发布链对「旧包名 + 数据文件名」敏感)。
 */
function readCapabilityCatalog(ctx) {
	try {
		const pc = ctx?.get?.("profileContext");
		const dir = (pc && typeof pc.dir === "string" && pc.dir)
			? pc.dir
			: join(DSH_HOME, "profiles", "web");
		const p = join(dir, "capability-catalog.txt");
		if (!existsSync(p)) return "";
		return readFileSync(p, "utf8").trim();
	} catch { return ""; }
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
	/* [v0.16.0 §2] 能力标签目录注入(仅**决策面**角色)。
	 * ★ 为什么只给决策面: 决策面需要「能派哪些能力」来选型; 执行面自己带
	 *   完整工具 schema, 目录对它没用(反而是冗余字节)。
	 * ★★ 覆盖范围(**如实**: 本版只兑现 1/N):
	 *   白名单**只含 cordis-router**。其余决策面角色(sci-foreman 等派工面、
	 *   sci-deep 等)本版**未纳入** —— 纳入它们属产品决策(哪些面该知道全部标签),
	 *   不是代码缺陷, 故不在本版夹带。
	 *   ★ 初版注释写「router / lead 系」与实现不符(lead 系是**能力标签**,
	 *     不是 brief 角色; 组装出的子代继承父 preset, 能否拿到目录取决于父角色)
	 *     ⇒ 注释已按实现如实改写。
	 * ★ 为什么目录是**文本**而不是工具: 目录不进工具目录(schema)⇒ 不占
	 *   每轮重发的工具目录税; 它是提示词里的一段静态文本(一次注入, 常驻)。
	 * ★ 缺失是**正常态**(host 未生成/未部署)⇒ 静默跳过, 不报错不降级 brief。 */
	const DECISION_BRIEFS = new Set(["cordis-router"]);
	const catalog = DECISION_BRIEFS.has(brief) ? readCapabilityCatalog(ctx) : "";
	const parts = [common, role];
	if (catalog) parts.push(catalog);
	const text = parts.filter((s) => s !== void 0).join("\n\n");
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
	/* [v0.14.5 删·根因修复] **正面清单自治理整段删除**(原 v0.7.1 引入, a5d7791)。
	 *
	 * 它是 router「允许 17 件却只可见 6 件」的**唯一根因**, 三重叠加:
	 *   ① 落点错: 本插件挂在 preset 树内(cordis.patch.yml role-brief 行), 其 ctx 的
	 *      scope = **preset generation key**(dsh-agent-preset-registry:511-513
	 *      createScope(this.owner,key) → :219-236 mountPreset 在该 ctx 建树)。
	 *      而 generation 是 agent scope 的**父**(:684-686 bindScopeParent) ⇒ 这份
	 *      restriction 被**所有 router 会话共享**、重启后重建、恒久存在。
	 *   ② 视角错: 无参 view() = **纯全局层** ⇒ preset_allow 19 件里当时只有 6 件在
	 *      全局层 ⇒ generation 层被永久钉上 allow-6。preset 自己注册的 9 件行工具
	 *      (subagent/workflow/todo_write/skill…) 从不是全局工具 ⇒ 必被排除。
	 *   ③ 交集放大: gateMain 的 restrict({allow:17}) 落 agent own 层, 但可见性 =
	 *      layers.every(admits) **含祖先层**(dsh-tools:492) ⇒ 17 ∩ 6 = 6。
	 * 实测: router 主通道 `subagent` 被自己的治理代码永久禁掉(生产台账 5 条 depth0
	 * 记录恒为 面=6; 会话日志 request/header 实取可见集 = add_note/dispatch_composed/
	 * list_agent_presets/note_recent/note_search/working_directory)。
	 *
	 * ★ 为何可以删(它本就是冗余): 它建于此的初衷是"手开会话 header.agentPreset
	 *   不回写、gateMain 判身份恒错"(见 git a5d7791 提交说明)。但生产台账 **5 条
	 *   depth0 router 记录全部 preset=cordis-router**(header 读得出来)⇒ gateMain
	 *   本就能识别手开 router 会话并施加正面清单制 ⇒ 这份自治理纯属冗余且有害。
	 * ★ 唯一能写 generation 层 restriction 的就是本处(全插件 grep: host.v2.mjs 的
	 *   8 处 restrict 全在 agent scope; 官方包仅 dsh-subagent 两处, 也是子代侧)。
	 *
	 * 本插件现在的职责 = **只注入 prompt 引导**, 裁剪权威一律归 dtg host 侧。
	 * (若日后仍需"按 brief 身份裁剪", 正确做法是在 host 侧按 preset 键统一施加,
	 *  落点必须是 agent scope —— 钉在共享祖先层的 restriction 会跨会话污染。)
	 */
	return () => {
		try {
			if (disposer && typeof disposer === "function") disposer();
			else disposer?.dispose?.();
		} catch { /* noop */ }
	};
}
