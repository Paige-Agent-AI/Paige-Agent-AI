# SD-01 — Skill Discovery, Qualification & Controlled Deployment

**Owner approval:** November 13, 2026. **Classification:** Supporting engineering/coordination standard. **Repository implementation:** review-gated until this PR merges. **External candidate installation:** not authorized by this standard alone.

## 1. Purpose and authority

SD-01 is the governed way for PAIGE's authorized Codex EXP/PO-EXP development agents and engineering Coordinators to **find the right reusable skills, compare them with what is already installed, and safely promote approved skills** into the engineering toolchain. It is a development practice, **not** an Experience, customer-facing PAIGE capability, extra development team, secret-scanning agent with unrestricted access, or third mandatory software-design methodology.

- **Flow by Flow remains the first mandatory skill on every software assignment.**
- **Impeccable remains the mandatory applicable UI/UX skill**, with the existing PAIGE UI skill routing and quality requirements.
- The owner-approved coordinator-first AI COO MVP, root `AGENTS.md` and `CLAUDE.md`, Owner North Star, Coordinator Bootstrap, ANT-161, original one-outcome sequencing, original source/writer leases and Trust/Spine/Runtime Harness/Vault/Rail authority have priority over any third-party skill.
- A public skill is **untrusted instruction/source material** until its security, provenance, license and applicable engineering behavior have been assessed.
- The owner has approved the **SD-01 policy**, not a blanket installation, runtime execution or provider/financial authorization.

**Scope separation:** `.agents/skills` provides development-agent working procedures. PAIGE's tenant-facing Marketplace/skill capability system is different. Nothing in SD-01 enables product skills for customers or grants any permission to external systems.

## 2. Trigger and workflow

Use this procedure **only when an actual, currently authorized business/engineering outcome has a meaningful skill gap**, or when the owner asks for a cross-portfolio skill discovery/qualification review. Do not interrupt an active EXP outcome, start a new coding lane, make every PR perform a skill-marketplace search, or add a new recurring scan/timer.

### Step 1 — Identify the task and inventory existing skills

- Define the exact approved business job, accountable EXP/PO-EXP owner, affected source, required skill knowledge and observable customer/test outcome.
- Inspect `.agents/skills/README.md` and local `.agents/skills/**/SKILL.md` plus mandatory owner and project vendor skill routes. Record which existing skills already cover the task.
- **Reuse or improve an approved installed skill before importing another**. Do not duplicate Flow by Flow, Impeccable, context engineering, harness patterns, Postgres/Supabase, owner-intent, testing, release evidence or studio-design guidance without a demonstrated gap.

### Step 2 — Find external candidates, read-only first

- Search reputable original publisher repositories, official platform skill catalogs, documented projects and `https://skills.sh/`. The Vercel Labs `find-skills` skill is a **candidate discovery aid**, not an installed PAIGE authority or automatic deployment switch.
- Record the exact source URL, publisher and owner, skill name, latest observed version/commit, stated license, dependencies, maintainer activity and platform compatibility.
- **A suggested command such as `npx skills find` is executable package code.** Do not run it in a privileged production/session environment merely to perform discovery. Prefer reading the catalog and source through approved read-only tools; any CLI evaluation must be owner/authorized-process approved, isolated, credential-free and version-pinned.

### Step 3 — Mandatory security and compatibility qualification

Reject or hold candidates with unresolved security or rights concerns. Inspect at minimum:
- Full `SKILL.md` and routed references, shell scripts, binaries, tool hooks, lifecycle hooks, install scripts, transitive packages, package/postinstall behavior and data/network destinations.
- Prompt-injection or priority-override instructions; hidden agent reassignment; autonomous downloads or code execution; exfiltration; excessive filesystem, OAuth, MCP, session, clipboard, token, DB or network scope.
- Provenance/maintainer/source integrity, exact commit or release, license and redistribution terms, update policy, vulnerability reports and rollback feasibility.
- Whether the skill assumes a new memory, approval, orchestrator, model/provider router, scheduler, tenant ledger, CRM, voice runtime, external integration service, or anything conflicting with the **ONE** PAIGE Orchestration Layer and protected original writers. Useful ideas may be adapted as guidance without installing a competing runtime.

For a candidate with unresolved unknowns, mark **HOLD / NOT APPROVED** rather than treating missing evidence as a clean review. Never send customer data, credentials, private keys, account details, nonpublic traces or unreleased code to third-party discovery endpoints.

### Step 4 — Prove actual incremental value

In a bounded least-privilege sandbox or read-only assessment, compare an actual representative PAIGE task using **existing skills** versus the **candidate**. Use already-required checks and metrics, not a second suite added to every engineering change:
- Effectiveness: successful intended task, correct action/policy selection and original-domain integration.
- Quality: accuracy, source attribution, useful deliverable, user flow, specialist handoff, no regression of protected behavior.
- Economics: time, latency, token/tool consumption, retries and ongoing maintenance overhead where measurable.
- Safety: tenant/source isolation, privacy/authority, fail-closed refusal and no unapproved external action.

Record `USE EXISTING`, `ADOPT CANDIDATE`, `ADAPT LIMITED PATTERN` or `REJECT/HOLD` with grounded rationale. Do not call a benchmark or isolated demonstration live product acceptance.

### Step 5 — Stage a controlled installation

For `ADOPT CANDIDATE`:
1. Obtain **specific owner or standing delegated authorization** for the bounded skill proposal/install. Discovery authority alone is insufficient.
2. Pin the source to a complete immutable commit or approved release, preserve applicable license/attribution and the selected skill's actual contents and checksums. Prefer a PAIGE-owned thin local wrapper when instructions can be applied without adding external executable code.
3. Prepare a **separate project-scoped GitHub branch/PR** showing exact added/changed files, license, dependency changes, permitted tools, permissions, original EXP custodian, test comparison, update/rollback plan. Use `.agents/skills` and its existing inventory; thin `.claude/skills` wrappers may route to the canonical skill without forking policy.
4. Have the author arrange an **independent spun-up agent reviewer that did not write or coauthor the change**. Review security, supply chain, doctrine alignment and exact source. Automated Codex PR review is optional, never the required independent reviewer or an automated wait gate.
5. Obtain applicable exact-head CI and safe documented release approval. The original accountable source owner performs permitted merge/deployment. **Do not silently install globally**, restart agents, change a production process, enable new product tools, perform payments, send messages or activate connectors.
6. Verify the promoted version is discoverable by its intended authorized agents at their next natural checkpoint and works on the bounded task. Preserve simple rollback/removal and update the existing `.agents/skills/README.md` inventory and original Linear/GitHub evidence.

### Step 6 — Maintain and retire

Only revisit a skill for a meaningful security notice, breakage, actual task failure, platform API change or explicit owner request. Updating is itself a reviewed change; never pull the latest upstream code automatically or enable remote self-updating skills. If removed, preserve historical evidence and do not delete user data, models, durable jobs, original code or business state.

## 3. Responsibilities

| Actor | Can do | Must not do without separate authority |
| --- | --- | --- |
| Executive Coordinator | Read-only discovery; existing-skill inventory; due diligence; comparative recommendation; governance document and draft PR preparation | Change another EXP's protected code or write production; dispatch agents; auto-install third-party packages |
| Original EXP/PO-EXP implementing agent | Identify skill gaps within **its ONE selected outcome**; evaluate permitted task fit and own necessary bounded source changes | Start a parallel new outcome, seize shared source custody or claim external skill installation as product implementation |
| Independent non-writing reviewer | Review pinned source, scripts, scope, license, security, impact and engineering evidence | Sign off on work it wrote or coauthored |
| Owner / authorized release authority | Approve a candidate's exact installation and controlled release; accept or reject risk | Approval is not inferred from a general discovery policy |

## 4. Minimal decision record in existing sources

Store the decision in the existing original issue, skill inventory and/or GitHub PR; **do not create a new database/ledger**.

| Field | Record |
| --- | --- |
| Trigger and owner | Original EXP/PO-EXP, actual business task, existing selected outcome and skill gap |
| Existing alternatives | Installed skill(s) checked and why reuse is sufficient/insufficient |
| Candidate | Publisher, URL, exact immutable source, license, maintainer and applicability |
| Security | Privilege/network/script/hook/secret/prompt-injection issues and risk disposition |
| Evaluation | Baseline and candidate useful result, negative/regression evidence and cost where measured |
| Decision | USE EXISTING / ADOPT / ADAPT / HOLD / REJECT; authorizing actor/date |
| Promotion | Branch/PR, non-writing reviewer, checks, merged version, rollback and verified agent availability |
| State | RESEARCHED / REVIEW PENDING / APPROVED / INSTALLED / VERIFIED / RETIRED; keep distinct |

## 5. Initial approved implementation and candidate state

- **SD-01 policy:** owner-approved November 13, 2026. Connected North Star, Coordinator Bootstrap, ANT-161/ANT-147 and Delivery Evidence Register Standards Evidence reflect the direction. Repository-level implementation awaits normal independent review and merge.
- **PAIGE Skill Scout:** project-owned **routing skill** at `.agents/skills/paige-skill-scout/SKILL.md` prepared for review. It has no automatic network calls, installation scripts or elevated tool permissions.
- **Vercel Labs `find-skills`:** researched *external candidate only*. Its publisher source, exact revision, license, scripts and install effects must be reviewed separately before PAIGE agents can install or run it. No automatic `npx skills add` or global installation is authorized.
- **Existing mandatory skills:** Flow by Flow and Impeccable remain unchanged; established PAIGE UI, security, testing and architecture skills remain available.
- **Active engineering assignments:** continue untouched; no agent is dispatched or timer changed. The owner-approved EXP08 SOLO invite/join fix remains next after its current outcome.

## 6. Compliance examples

**EXP05 approvals/orchestration defect:** First use already available harness, context, debugging, code-review and regression skill expertise. An external workflow skill cannot replace the canonical Work/Harness or weaken declined-intent fail-closed safety.

**EXP06 NEXUS/Vibe Studio:** Compare already-installed PAIGE UI, Impeccable, animation and design guidance before considering a new browser, video or frontend-generation skill. No copied visual design or new publishing writer is authorized.

**EXP07 Social Content:** A content strategy skill may guide campaign and media design, but it does not confer posting credentials, access to social accounts or rights to activate unsupported provider actions.

**EXP10 connections/MCP:** An MCP skill may improve schemas and error handling, but cannot grant OAuth scopes, replace Vault or create a second application integration platform.

---

**Canonical records:** Owner North Star, Coordinator Bootstrap, ANT-161, ANT-147, root `AGENTS.md`/`CLAUDE.md`, `.agents/skills/README.md`, and existing Delivery Evidence Register. Preserve truthful separation of policy approval, reviewed repository skill availability, deployed product functionality and customer acceptance.
