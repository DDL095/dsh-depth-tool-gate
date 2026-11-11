<div align="center">
  <img src="./icon.svg" width="96" alt="dsh-depth-tool-gate">
  <h1>dsh-depth-tool-gate</h1>
  <p><b>Cut every DSH subagent's tool surface down to what its job needs — and its prompt down to what it must read.</b></p>
  <p>
    <a href="https://www.npmjs.com/package/dsh-depth-tool-gate"><code>npm i dsh-depth-tool-gate</code></a>
    · <a href="./docs/panel-guide.md">Panel guide</a>
    · <a href="./docs/agent-faq.md">FAQ</a>
    · <a href="./versions.md">Changelog</a>
  </p>
</div>

---

**dsh-depth-tool-gate** is a governance plugin for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (DSH). It controls **which tools each agent can see** and **how much instruction text each agent carries** — at the host level, where it cannot be talked out of.

A DSH subagent inherits the main session's entire tool catalog and the full global instruction set, whether it needs them or not. A "read these three papers" worker ends up holding image-generation, plugin-management, system-restart and scheduling tools it will never use — each one carrying a schema that is re-sent on every turn. dsh-depth-tool-gate cuts that down by policy, records what it did, and lets you audit the result.

> **Quick start** — DSH ≥ 0.2.2-rc.1, Node ≥ 24.9.0. In your DSH profile directory (`~/.dsh/profiles/web`): `npm i dsh-depth-tool-gate`, then **append** `"dsh-depth-tool-gate"` to the `dsh.profile.bundles` array in that profile's `package.json`, restart DSH, and open **Settings → Subagent Tool Surface**. Full steps and prerequisites: [Install](#install).

**当前版本 v0.12.1** · 中文说明见 [下方](#中文说明) · 中文文档 `docs/*.md`

---

## The problem, concretely

| | Without a gate | With dsh-depth-tool-gate |
|---|---|---|
| **Tool catalog** | Every subagent inherits the host's full global tool set — measured at 90 tools ≈ 33k tokens of schemas, re-sent every turn (measured on DSH 0.2.2-rc.1) | Each agent sees only what its role needs — the `reader` capability tag resolves to 8 tools, i.e. ≈29k tokens less per turn |
| **New tools appearing** | A DSH upgrade or a newly installed plugin silently widens every subagent's surface | New tool names are held in a **pending gate** and blocked until you rule on them |
| **Prompt budget** | Subagents inherit the full global instruction file (tens of KB) plus injected sections about tools they do not have | Per-role briefs replace the bulk of it (1.8–3.4 KB in the shipped presets), and sections about absent tools are masked out (≈4.4 KB of dead sections dropped, measured with `provenance_audit`) |
| **Wasted capability** | A subagent holds "restart the whole system" or "install software" next to "read a file" | Dangerous and irrelevant tools are denied by name, per role |
| **Auditability** | Whatever the tool surface is, it is invisible | Every decision is written to an append-only JSONL ledger, with a panel that replays it |
| **On-demand minimalism** | A task needs one narrow tool set, so it gets all of them | `dispatch_composed` assembles a temporary minimal surface from capability tags |

---

## What it actually does

### 1. Deny-list gating (the core)

On `agent/created`, the plugin computes the effective deny list for that agent and applies it through the host's `tools.restrict()` API.

Six lists, each with its own scope. The subtle one is `preset_allow`, because its effect depends on **which preset the agent runs under**:

| List | Applies to | Meaning |
|---|---|---|
| `baseline_deny` | all subagents (depth > 0) | the floor — tools no worker should have |
| `preset_extra_deny[preset]` | one role | additional denies for that role |
| `preset_allow[preset]` | one role | for a **plain subagent**: an exemption list — these names are removed from the deny floor, everything else still gets denied. For a **preset that mounts the `role-briefs` module** (all three bundled presets do): a **keep-only** list — the agent ends up with exactly these tools |
| `main_deny` | the main session (depth 0) | tools you don't want in your own session either |
| `main_preset_extra_deny[preset]` | a main session opened with that preset | role-specific denies layered on top of `main_deny` |
| `main_preset_allow[preset]` | a main session opened with that preset | **keep-only** for that main session: only the listed tools stay visible |

Order of application for a **plain subagent**: `baseline_deny` ∪ `pending` → minus `preset_allow[preset]` → plus `preset_extra_deny[preset]`.

For an agent running under a preset that mounts `role-briefs`, the module applies `preset_allow[brief]` as a keep-only restriction on top of that — so for those presets the list behaves as keep-only rather than as an exemption. This dual behaviour is deliberate (it is how a hand-opened session ends up with the same surface as a delegated one) but it means the same key means different things depending on the preset.

For a **main session**: if an allow-list applies it becomes keep-only (and `main_deny` is not layered on); otherwise `main_deny` ∪ `main_preset_extra_deny[preset]` is denied. Note that `main_preset_allow` falls back to the shared `preset_allow[preset]` key when the former is not set — and the shared key is keep-only on the main-session path too. The plugin logs a warning when that fallback happens, so you can spot it in the host log.

A `PROTECTED_MAIN` set (18 core tools: file access, planning, the user-interaction tools…) is stripped from `main_deny` automatically. It does **not** apply to the keep-only path: a narrow `main_preset_allow` can therefore still hide `read`/`write`/`shell` from a main session. Keep `main_preset_allow` generous, or use `main_deny` instead.

**Timing:** configuration is hot-read, but a change applies only to agents **created or resumed** after it — running sessions keep the surface they were born with.

**First run:** the gate seeds itself from the tools already present at install time and marks them `seen`, so the *new-tool gate* does not block anything on day one (your configured deny lists still apply, of course). Only tools that appear *later* (a DSH upgrade, a newly installed plugin) enter `pending`. If the pending list is empty right after installation, that is the expected state, not a broken gate.

### 2. The new-tool gate (lock)

Any tool name the runtime has never seen before is recorded as `pending`. With `autoDenyNew` on (the default), pending names are denied to subagents until you rule on them.

```
pending  →  denied to subagents, waiting for a ruling
seen     →  already ruled (allowed or denied), stays as-is
forced   →  registered by a preset, so restrict() cannot reach it — shown greyed out
```

Stale entries are **never cleaned up**: if a plugin you disabled comes back, the gate remembers and it takes effect again.

### 3. Preset access control

You can forbid a preset from being used as a subagent. The child is still spawned (the block happens after creation, so a slot is briefly consumed), then restricted to a minimal reporting surface (`note_search`, `send_message`); the event is recorded in the ledger as `preset-denied`. This fails **closed**: if the restriction cannot be applied, the child gets *no* tools rather than all of them.

> Known limitations: the block happens after the child is created, so the spawn still consumes a slot (entry-point validation is a planned improvement); and hiding is limited to the `list_agent_presets` tool — the host's own preset list in the UI still shows the preset.

> Note the name collision: `preset_deny` is about **presets**, while `preset_allow` / `preset_extra_deny` are about **tools**. Putting a preset id into a tool list does not disable the preset.

### 4. On-demand minimal surfaces (`dispatch_composed`)

Instead of picking a preset, you can assemble a surface from capability tags:

```js
dispatch_composed({
  prompt: "Extract the key findings from these papers and write them to findings.md",
  capabilities: ["literature"],       // union of tag allow-lists
  tools: ["write"],                     // extra names, merged in
  description: "literature digest ×1"
})
```

The child is born with **only** the union's tools — everything else, including tools that appear later, is invisible to it. Tag definitions live in `capabilities` in the config and are fully overridable. A tag whose allow-list contains `dispatch_composed` additionally lets the child spawn one more generation; the built-in `reader-lead` and `literature-lead` tags do. There is no `-lead` suffix parser — "lead" is simply a property of the tag's tool list.

### 5. Per-role instruction briefs (`role-briefs`)

Instead of loading the whole global instruction file into every subagent, each role gets a compact brief: a shared `_common.md` plus a role-specific file, injected as a system-prompt section (so it can be attributed byte-precisely by `provenance_audit`). Budget target: ≤3 KB per child.

### 6. Prompt-section masking (`prompt-slim`)

A preset can mask named global system-prompt sections by registering same-named empty sections — the host's scoped-shadow mechanism then drops them entirely for that preset. A child that has no scheduling tools does not need the scheduling instructions.

### 7. The panel (7 tabs)

Settings → **Subagent Tool Surface** (子代理工具面):

| Tab | What it does |
|---|---|
| 📋 全局工具面 / Global tool surface | Two collapsible columns: the configured deny list and the runtime-discovered tools not yet ruled on, with a source filter, a per-tool explainer, and a batch prompt generator for bulk decisions |
| 🧭 主会话与访问 / Main session & access | Which presets may be dispatched at all; plus per-role denies for main sessions |
| 👥 子代理按角色 / Subagents by role | The final deny surface per role, and the raw list editors |
| 🧪 能力标签 / Capability tags | The tag → allow-list table used by `dispatch_composed` |
| 📊 调用频率 / Call frequency | Per-tool and per-preset call counts, plus the most recent 40 sessions (per-session breakdown; older sessions drop out of the list) |
| 📜 裁剪台账 / Audit ledger | One row per agent creation, plus red rows for governance events (lock corruption, config corruption, gate errors, missing briefs) |
| 🚦 闸门与发现 / Gate & discovery | Pending rulings (four actions per tool), and a per-item reason for every stale list entry |

### 8. Read-only diagnosis (`explain_gate`)

`explain_gate` is a **tool that agents call inside a DSH session** — it is not a shell command. It explains the *current* agent's surface and the reason for every cut, without changing anything:

```
[explain_gate] 可见 99/116 | 裁 17 件
  ✂ generate_image — main_deny(主会话显式名单)
  ✂ mcp__codex__codex — main_deny(主会话显式名单)
```

(Each line names the list responsible for the cut. The reasons are mutually exclusive per scope: a **main session** can report `main_deny`, a **subagent** reports `baseline_deny` / `preset_extra_deny` / `preset_allow 正面清单外` / `lock pending`. Ask the agent in your session to run it, or call it from a tool-use turn. The counts above are illustrative; they depend on your own lists.)

---

## Install

**Step 1 — add the package to your DSH profile** (run this in your DSH profile directory, e.g. `~/.dsh/profiles/web`, so the dependency lands in that profile's `package.json`):

```bash
cd ~/.dsh/profiles/web        # your profile dir
npm i dsh-depth-tool-gate
```

**Step 2 — register the bundle.** Edit the *same* profile `package.json`: add `"dsh-depth-tool-gate"` to the **end of the existing `dsh.profile.bundles` array**. Keep the entries you already have — the array is replaced wholesale if you paste a shorter list over it.

```jsonc
{
  "dependencies": {
    "dsh-depth-tool-gate": "^0.12.1"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-depth-tool-gate"        // ← append, don't replace the list
      ]
    }
  }
}
```

**Step 3 — restart DSH** (the host half is loaded at boot), then open **Settings → Subagent Tool Surface**. If that panel is missing, the bundle did not load — check that the package is installed in *this* profile and that the name is spelled exactly `dsh-depth-tool-gate`.

**Step 4 — verify.** Ask your agent to call `explain_gate`; it should report a visible count and the tools it cut, with a reason for each.

### Requirements

- **DSH ≥ 0.2.2-rc.1** — the plugin relies on four host-internal behaviours: `tools.restrict()` / `tools.view()` exist and fail loudly on unknown names, `view()` takes a scope key, the "own" layer is exempt from restrictions, and restrictions compose as an intersection. It also uses `createScope()` from `@deepseek-ai/dsh-scope`, passing only the context and key (its third `options` argument is not used).
- **Node ≥ 24.9.0** (matches the host).
- Peer packages are provided by the host: `@deepseek-ai/dsh-scope`, `@deepseek-ai/dsh-typert-protocol`. They are declared as optional peer dependencies, but the plugin imports them statically — **if your DSH installation does not already provide them, the plugin will fail to load with `ERR_MODULE_NOT_FOUND`**. Do not install them yourself unless your setup requires it.

---

## Configuration

`$DSH_HOME/profiles/<profile>/depth-tool-gate.config.json` — hot-read, and rewritten by the panel.

The file itself must be **strict JSON** (no comments, no `…` placeholders). The block below is annotated for reading only; the panel writes a valid file for you:

```jsonc
{
  "enabled": true,
  "autoDenyNew": true,                // block tool names that appear later, until ruled on
  "baseline_deny": ["tool_name"],      // the floor for all subagents
  "preset_allow": { "my-role": ["tool_name"] },        // exemption from the floor, per role
  "preset_extra_deny": { "my-role": ["tool_name"] },  // extra denies, per role
  "main_deny": ["tool_name"],         // the main session only
  "main_preset_allow": { "my-preset": ["tool_name"] },        // keep-only, main session
  "main_preset_extra_deny": { "my-preset": ["tool_name"] },  // extra denies, main session
  "preset_deny": ["some-preset"],     // this preset may not be used as a child
  "preset_supplement": ["some-preset"],  // re-attach this preset's tools to externally dispatched sessions
  "capabilities": { "my-tag": ["tool_name"] }  // tags for dispatch_composed
}
```

Key notes:

- `preset_supplement` exists for presets whose sessions are dispatched through a channel that does not mount the preset's own rows (for example a flat peer session). For those, the preset's `preset_allow` list is re-attached as missing tools. Leave it empty unless you know you need it.
- `capabilities` **replaces** the built-in tag table when it is present **and non-empty** (an empty object falls back to the built-in table). Built-in tags:

  | Tag | Tools | Of those, MCP tools |
  |---|---|---|
  | `reader` | 8 | 0 |
  | `reader-lead` | 9 | 0 |
  | `ocr` | 9 | 2 |
  | `literature` | 22 | 15 |
  | `literature-lead` | 23 | 15 |

  The MCP-based tags name tools from MCP servers that only exist if you have those servers installed. Missing MCP tools are **dropped from the allow-list** (and counted as `droppedUnknown`), while the remaining built-in tools still apply — so `literature` degrades to its 7 non-MCP tools rather than to an empty surface. If your tool set differs, define your own tags.
- An **unknown** capability tag is a hard error: the dispatch is rejected with `未知能力标签: <tag>` and the list of available tags. It does not silently fall back.

Companion files, all under `$DSH_HOME`:

| Path | Role |
|---|---|
| `profiles/<profile>/depth-tool-gate.config.json` | policy (above) |
| `profiles/<profile>/depth-tool-gate.lock.json` | the new-tool gate state — maintained by the plugin, do not hand-edit |
| `profiles/<profile>/depth-tool-gate.usage.json` | call-frequency snapshot |
| `logs/depth-tool-gate/audit.jsonl` | append-only audit ledger |
| `logs/depth-tool-gate/spill/composed-reply-*.md` | full text of a `dispatch_composed` reply that exceeded the inline reply limit (64 KB) — the agent gets the path back and can read it |
| `node_modules/dsh-depth-tool-gate/agents-briefs/` | the role briefs the `role-briefs` plugin reads — `_common.md` plus one file per role |

The briefs live **inside the installed package**, next to `role-briefs.mjs` — not in your profile. To add your own role, drop a `<role>.md` file in that `agents-briefs/` directory and reference it from a preset row with `config: { brief: "<role>" }`. Two caveats: files added there live under `node_modules`, so **an npm upgrade replaces them** — keep your own copies elsewhere and re-add them; and a brief that cannot be read is **not** fatal: the plugin logs a `role-brief-missing` event and continues, but that agent then runs with no role guidance at all — so check the ledger if a subagent seems to be missing its instructions.

### Presets included in the bundle

| Preset | Purpose |
|---|---|
| `dtg-shell` | an empty shell used as the base for `dispatch_composed` children (required by that feature) |
| `cordis-sub` | a general-purpose subagent preset with a brief injected |
| `cordis-router` | a dispatch-only main session preset: no execution tools, delegation only |

---

## Privacy

- The call-frequency collector records **tool names and counts only**. Arguments and tool content are never stored.
- The audit ledger records agent ids, depths, preset names, counts and rule decisions — not what the agents said or did. It does let you reconstruct *when* a given preset spawned which agents, so treat it as operational metadata.
- A `dispatch_composed` reply longer than 64 KB is written in full to `logs/depth-tool-gate/spill/composed-reply-*.md` — that file contains the subagent's **actual output text**. It stays on disk until you delete it.
- All data stays on your machine under `$DSH_HOME`: no telemetry, no network calls, no install scripts.
- All timestamps are stored in UTC and displayed in your local timezone.

---

## Documentation

| Document | What it covers |
|---|---|
| [Panel guide](docs/panel-guide.md) | every tab, field by field |
| [Agent FAQ](docs/agent-faq.md) | how the mechanism works, from an agent's point of view |
| [Troubleshooting](docs/troubleshooting.md) | silent-degradation family first: what to check, in what order |
| [Audit schema](docs/audit-schema.md) | every field of the ledger and the lock file |
| [Tool annotations](docs/tool-annotations.md) | what each governed tool is, and why it is governed |
| [Changelog](versions.md) | release history |

---

## 中文说明

**dsh-depth-tool-gate** 是 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（DSH）的**工具面与提示预算治理插件**。

DSH 的子代理默认继承主会话的**全部工具**与**全部全局引导**：一个"读三篇论文"的干活代理，照样握着文生图、插件管理、系统重启、定时任务这些它永远不会用的工具 —— 每件工具的 schema 都要在**每一轮**重新发送一遍。dsh-depth-tool-gate 按策略把这些裁掉，并留下可查的账。

> **快速开始** —— 需 DSH ≥ 0.2.2-rc.1、Node ≥ 24.9.0。在你的 DSH profile 目录（`~/.dsh/profiles/web`）下执行 `npm i dsh-depth-tool-gate`，然后把 `"dsh-depth-tool-gate"` **追加**到该 profile `package.json` 的 `dsh.profile.bundles` 数组末尾，重启 DSH，打开 **设置 → 子代理工具面**。完整步骤与前置条件见 [Install](#install)。

### 核心机制

| 机制 | 说明 |
|---|---|
| **负面清单闸门** | `agent/created` 时按名单算出禁用集合，用宿主 `tools.restrict()` 强制裁剪。**普通子代理**：`baseline_deny` ∪ `pending` → 减去 `preset_allow[role]`（豁免）→ 并上 `preset_extra_deny[role]`；**挂了 `role-briefs` 的 preset**（随包三个都挂了）：`preset_allow[brief]` 另作 keep-only 生效 → 面就等于该清单；**主会话**：有正面清单则 keep-only（`main_deny` 不叠加），否则裁 `main_deny` ∪ `main_preset_extra_deny[preset]`。主会话另有 18 件保护集（仅在 deny 分支生效，keep-only 分支不保护），误裁会被自动剔除并告警 |
| **新工具闸门（lock）** | 运行时首次出现的工具名记为 `pending`，默认拦截子代理，等你裁决。三态：`pending` 待裁决 / `seen` 已裁决 / `forced` preset 注册不可达（灰显）。失效条目**永不清理**，重装即复效。**首次安装会按当时已有的工具建档并标 `seen`**（拦新不拦旧），所以刚装好时 pending 为空是预期状态，不是闸门失效 |
| **preset 访问控制** | 禁止某些 preset 被用作子代：子代只留最小回报面（`note_search`/`send_message`），台账记 `preset-denied`。**fail-closed**：裁剪失败则一件工具都不给，绝不给全量。⚠ 拦截发生在创建**之后**（子代仍会 spawn、占一次名额）；隐藏只作用于 `list_agent_presets` 工具，宿主 UI 的 preset 列表仍会显示 |
| **动态工具面组装** | `dispatch_composed(capabilities=["literature"])` 按能力标签取并集，子代出生即只保留该面 —— 面外一切（含未来新工具）不可见。内置 5 个标签：`reader`(8 件/0 MCP)、`reader-lead`(9/0)、`ocr`(9/2)、`literature`(22/15)、`literature-lead`(23/15)。缺 MCP 时 **MCP 件被丢弃、其余保留**（不是空面）。标签写错则**直接失败**并列出可用标签 |
| **角色化引导** | 不再让子代背全量全局引导：改为 `_common.md` + 角色专属文件拼接注入（系统提示段，可按 `provenance_audit` 精确归因字节）。随包三个岗位的注入文本实测 1.8–3.4 KB（`_common` 1.4KB + 岗位段 0.5–2.1KB） |
| **提示段遮蔽** | `prompt-slim` 让 preset 内同名空段遮蔽全局段 —— 没有定时任务工具的子代，不必读定时任务纪律 |
| **可视化面板** | 设置 → 子代理工具面，7 个 Tab：全局工具面 / 主会话与访问 / 子代理按角色 / 能力标签 / 调用频率 / 裁剪台账 / 闸门与发现 |
| **只读诊断** | `explain_gate` 解释当前 agent 的工具面：可见几件、裁了几件、**每件为什么被裁**。它是**会话内 agent 调用的工具**，不是命令行命令 |

### 生效口径

- 配置**热读**，但只对**之后创建或恢复**的会话生效；运行中的会话保持出生时的工具面不变。
- 频率快照落盘，重启不清零。
- 主会话与子代理的策略**分场景独立配置**（`main_preset_*` 与 `preset_*` 分键），旧配置自动回落兼容。

### 安装

四步（详见上方 [Install](#install)）：

1. 在**你的 DSH profile 目录**下执行 `npm i dsh-depth-tool-gate`；
2. 把 `"dsh-depth-tool-gate"` **追加**到该 profile `package.json` 的 `dsh.profile.bundles` 数组**末尾**（不要整个替换 —— 数组会被整体覆盖，写短了会清掉你原有的 bundle）；
3. 重启 DSH；
4. 验证：让 agent 调 `explain_gate`，应返回可见数与裁剪原因。

若设置里找不到「子代理工具面」面板 = bundle 未加载（检查是否装在**本** profile、包名是否拼写一致）。

### 前置条件

- **DSH ≥ 0.2.2-rc.1**（依赖宿主四条内部语义：`tools.restrict()/view()` 存在且对未知名 fail-loud、`view()` 收 scope key、own 层豁免 restrictions、限制取交集；另用 `createScope()`，只传 ctx 与 key 两个参数）
- **Node ≥ 24.9.0**（与宿主一致）
- 两个 peer 包由宿主提供（`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-typert-protocol`）。它们声明为 optional peer，但插件是**静态 import** —— 若宿主未提供，插件会以 `ERR_MODULE_NOT_FOUND` 加载失败

### 隐私

- 频率采集**只记工具名与调用次数**，不落 arguments 与工具内容。
- 台账只记 agent id / 深度 / preset / 件数 / 裁决，不记代理说了什么、做了什么；但它能复原"何时哪个 preset 起了哪些代理"，属运维元数据。
- `dispatch_composed` 回执超过 64KB 时，**子代理的完整输出**会落盘到 `logs/depth-tool-gate/spill/composed-reply-*.md` —— 该文件含子代**实际输出正文**，需自行清理。
- 全部数据留在本地 `$DSH_HOME`：**无遥测、无网络调用、无安装脚本**。
- 时间戳存 UTC，按本地时区显示。

---

## Development

The repository is the single source of truth; `scripts/release-export.mjs` produces the publishable snapshot (staged, assertion-checked, then swapped atomically).

```bash
node --check host.v2.mjs && node --check client.js   # syntax
node scripts/smoke-save-nopresetmap.mjs                # host regression smoke
node scripts/smoke-readme-facts.mjs                    # README-vs-code fact gate
node scripts/release-export.mjs                        # build + assert the release snapshot
```

Release notes are in [versions.md](versions.md). The package ships the runtime, the client half, the locale files, the bundle patch, the role briefs, the five `docs/` guides listed above and the changelog.

Development-only assets — surgery scripts, archaeology notes, the internal release manual — live under `internal/` and are **not published**; see [internal/README.md](internal/README.md).

---

## License

MIT — see [LICENSE](./LICENSE).

The plugin is an independent community project for DSH; it is not affiliated with or endorsed by DeepSeek.
