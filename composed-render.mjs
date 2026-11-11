/* composed-render.mjs — dispatch_composed 的回执渲染(纯函数, host 与测试共用一份)
 *
 * 为什么独立成模块(而不是留在 host 里再抄一份到测试):
 *   旧形态是 host.v2.mjs 内联 render + scripts/test-render-logic.mjs 里一份
 *   "同构副本" —— 两份代码会漂移: 改了 host 的分支, 测试还在测旧副本, 于是
 *   测试全绿而真 render 已坏(本批改异步/批量返回形状时就会这样)。
 *   提取后测试直接 import 本文件, 测的就是真代码路径。
 *
 * 三种返回形状(v0.13.2):
 *   ① 单个 + wait=true → {capabilities, allowed, reply}
 *   ② 批量 + wait=true → {batch, count, dispatched:[{label, reply, ...}]}
 *   ③ 批量/单个 默认非阻塞 → {async, count, dispatched:[{childId, label, ...}]}
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const COMPOSED_RENDER_CAP = 65536;

/**
 * 把 dispatch_composed 的返回值渲染成 tool_result 文本块。
 * @param {object} value execute() 的返回值(或其 JSON 串)
 * @param {object} opts { dshHome, now } — dshHome 决定超长落盘位置
 * @returns {{type: "text", text: string}[]}
 */
export function renderComposed(value, opts = {}) {
	const dshHome = opts.dshHome;
	const now = opts.now ?? Date.now();
	try {
		const v = typeof value === "string" ? JSON.parse(value) : value;
		const one = (d) => {
			const cap = (d?.capabilities || []).join("+") || "custom";
			const extra = d?.toolsExtra ? `+直传${d.toolsExtra}件` : "";
			/* [v0.13.3] 成败判定: 有 error ⇒ 失败(✗)。子项不带 ok 字段是刻意的
			 * (不给显示目的污染数据形状), 所以判定顺序是: 显式 ok=false ⇒ ✗;
			 * 否则有 error ⇒ ✗; 否则 ✓。旧形态只判 ok===false, 导致
			 * 「✓ 失败: spawn 失败」自相矛盾。 */
			const failed = d?.ok === false || (d?.ok === undefined && d?.error !== undefined && d?.error !== null);
			const line = `[dispatch_composed ${failed ? "✗" : "✓"}] 面=${cap}${extra} allow=${d?.allowed ?? "-"}${d?.droppedUnknown ? ` 丢弃未知=${d.droppedUnknown}` : ""}${d?.childId ? ` id=${d.childId}` : ""}${d?.label ? ` 标签=${d.label}` : ""}`;
			return d?.error ? `${line}\n错误: ${d.error}` : line;
		};
		if (v?.error) return [{ type: "text", text: `[dispatch_composed ✗] 错误: ${v.error}` }];

		/* ③ 非阻塞: 列出派出的子代理, 完成结果由宿主异步投递 */
		if (v?.async) {
			const lines = (v.dispatched || []).map((d) => one(d));
			return [{ type: "text", text: `[dispatch_composed ✓] 已派出 ${v.count ?? lines.length} 个子代理(并行, 互不等待)\n${lines.join("\n")}\n${v.note || ""}` }];
		}

		/* ② 批量同步: 各子代理回执 */
		if (Array.isArray(v?.dispatched)) {
			const blocks = [];
			for (const d of v.dispatched) {
				const head = one(d);
				const full = String(d?.reply || "");
				if (!full) { blocks.push(head); continue; }
				if (full.length <= COMPOSED_RENDER_CAP) { blocks.push(head + "\n" + full); continue; }
				const spill = spillReply(full, dshHome, now, d?.childId);
				blocks.push(head + spill + "\n" + full.slice(0, COMPOSED_RENDER_CAP));
			}
			return [{ type: "text", text: `[dispatch_composed ${v.ok ? "✓" : "✗"}] 批量 ${v.count ?? blocks.length} 个子代理\n${blocks.join("\n\n")}` }];
		}

		/* ① 单个同步 */
		const head = one(v);
		const full = String(v?.reply || "");
		if (full.length <= COMPOSED_RENDER_CAP) return [{ type: "text", text: head + "\n" + full }];
		const spill = spillReply(full, dshHome, now, v?.childId);
		return [{ type: "text", text: head + spill + "\n" + full.slice(0, COMPOSED_RENDER_CAP) }];
	} catch (e) {
		return [{ type: "text", text: "[dispatch_composed] render 失败: " + String(e) }];
	}
}

/** 超长回执落盘: 返回提示片段(含路径)。落盘失败不炸, 降级为提示用 tool_result_index 读回。 */
function spillReply(full, dshHome, now, childId) {
	if (!dshHome) return `\n[全文 ${full.length} 字符超回执上限 ${COMPOSED_RENDER_CAP}, 未指定落盘位置]`;
	try {
		/* 目录名 = depth-tool-gate(与 host 的 AUDIT_DIR 同源, 历史 spill 文件在此);
		 * 不要写成 dsh-depth-tool-gate —— 那是包名, 与运行时数据文件名不是一回事
		 * (运行时数据文件名一律保持旧名, 见 host 顶部说明)。 */
		const dir = join(dshHome, "logs", "depth-tool-gate", "spill");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `composed-reply-${now}-${String(childId || "x").slice(0, 8)}.md`);
		writeFileSync(file, full, "utf8");
		return `\n[全文 ${full.length} 字符超回执上限 ${COMPOSED_RENDER_CAP}, 已完整落盘: ${file}]`;
	} catch {
		return `\n[全文 ${full.length} 字符超回执上限 ${COMPOSED_RENDER_CAP}, 落盘失败——用 tool_result_index/read_tool_result 按 callId 读回完整原文]`;
	}
}
