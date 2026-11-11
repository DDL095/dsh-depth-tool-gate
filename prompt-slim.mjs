/* dtg-prompt-slim — 子代理系统提示去冗余(preset scope 内同名空段遮蔽全局注入)
 *
 * 机制(dsh-system-prompt :248-251 白纸黑字): scoped section/context 同名遮蔽全局段;
 * 空文本段渲染时被过滤(:120/:157)——注入空段=原段在该 preset 的 agent 里完全消失。
 *
 * 遮蔽清单(2026-11-08 provenance 归因, 对子代约 4.6KB 纯冗余):
 *   ui:deliverable-file-references — present/交付规范(子代无 present 工具)
 *   app:web-surface               — Web GUI/HMR 开发上下文(子代不与用户交互)
 *   long-goal-convention          — goal/schedule 通道(子代无此工具, 且与 dtg-shell
 *                                   persona 铁律(8)"不建跨轮目标"直接矛盾)
 *   sibling-dispatch-discipline   — 平级派单纪律(非 lead 面无派单工具)
 *   harness:source                — DSH checkout 开发上下文(子代不动 DSH 本体)
 *   tool:bash-terminal            — shell/pwsh 使用指引(子代面无 shell)
 *   restart-guard-discipline      — dsh_web_restart 重启纪律(子代无此工具)
 *   mcp-resource-servers          — MCP resource 服务器段(子代无 list_mcp_resources)
 *   mcp:research-tools            — MCP server 说明(面内无该 server 工具时纯噪声)
 *   context: skill-scout-hint     — skill 提示(子代理冒烟实测曾分神处理它)
 * 保留(子代必需): context:file-reference(有 read 的面用 @ 路径)、approval/sandbox/
 *   working-directory 动态 context、persona/time-context 等行集自带段。
 *
 * 挂载: dtg-shell / cordis-sub / sci-lite 三 preset 的 plugins 行(file:// 直指仓内,
 * bundle link 形态=改仓内即生效; 详见 dsh-depth-tool-gate/README 部署节)。 */
export const name = "dtg-prompt-slim";
export const inject = ["systemPrompt"];

const HIDE_SECTIONS = [
	"ui:deliverable-file-references",
	"app:web-surface",
	"long-goal-convention",
	"sibling-dispatch-discipline",
	"harness:source",
	"tool:bash-terminal",
	"restart-guard-discipline",
	"mcp-resource-servers",
	"mcp:research-tools",
];
const HIDE_CONTEXTS = [
	"app:web-surface",
	"harness:source",
	"skill-scout-hint",
];

export function apply(ctx) {
	const sp = ctx.get("systemPrompt");
	if (!sp || typeof sp.section !== "function" || typeof sp.context !== "function") {
		console.warn("[dtg-prompt-slim] systemPrompt 服务不可用——跳过(提示冗余保留, 不影响功能)");
		return () => {};
	}
	const disposers = [];
	for (const name of HIDE_SECTIONS) {
		try { disposers.push(sp.section({ name, order: 700, text: "" })); } catch (e) {
			console.warn(`[dtg-prompt-slim] section 遮蔽失败(${name}): ${String((e && e.message) || e)}`);
		}
	}
	for (const name of HIDE_CONTEXTS) {
		try { disposers.push(sp.context({ name, order: 700, text: "" })); } catch (e) {
			console.warn(`[dtg-prompt-slim] context 遮蔽失败(${name}): ${String((e && e.message) || e)}`);
		}
	}
	return () => {
		for (const d of disposers) {
			try { if (d && typeof d === "function") d(); else d?.dispose?.(); } catch { /* noop */ }
		}
	};
}
