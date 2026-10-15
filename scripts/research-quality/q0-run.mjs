// Q0 — the INT-322 research-quality baseline harness (measurement ONLY; changes nothing).
//
// WHAT THIS DOES (one pass, --phase <name>):
//   run      — for each corpus case: ONE real production engine run (paige-deep-research,
//              caller JWT = the dedicated synthetic test owner, persist:true so the run lands
//              in the canonical store exactly like production), capturing the full response,
//              wall latency, and the DB trace rows for that run_id (model/provider/cost per
//              call). Writes docs/research-quality/q0/evidence/<ID>.json — the IMMUTABLE
//              before-state (never overwritten; a second attempt writes <ID>.r2.json).
//   metrics  — deterministic metric vector per case, computed ONLY from the evidence pack
//              (no model calls). Appends to the same pack under "deterministic_metrics".
//   seed     — inserts the corpus as paige_eval_dataset/paige_eval_case rows (the canonical
//              eval substrate; cases carry the engine OUTPUT in input jsonb + per-metric
//              rubrics), then POSTs paige-eval per metric-dataset so the GOVERNED rubric
//              judge (Claude reasoning, null-discipline, judge_model logged) scores the
//              semantic metrics. Judge results land in paige_eval_run/result.
//   report   — aggregates everything into docs/research-quality/q0/baseline.json.
//
// DISCIPLINE (the Q0 ruling):
//   • No engine/behavior change of any kind — this script only CALLS the deployed system.
//   • Judge sees only the case's output + rubric (blind to before/after by construction).
//   • Unscorable → null, never 0 (the substrate's §31 discipline; preserved verbatim here).
//   • Evidence packs are append-only; runs are never silently overwritten.
//
// AUTH (the established controlled-proof pattern): Q0_EMAIL/Q0_PASSWORD env (the dedicated
// synthetic test owner, vibe-proof-test@paigeagent-test.example; a fresh random password is
// set by the operator via the DB before the drive and rotated after). Q0_ANON_KEY env = the
// public publishable key.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const EV = join(ROOT, "docs", "research-quality", "q0", "evidence");
const SUPABASE_URL = process.env.Q0_SUPABASE_URL || "https://xygzykjyynhzqytbqnzu.supabase.co";
const ENGINE = `${SUPABASE_URL}/functions/v1/paige-deep-research`;
const EVAL = `${SUPABASE_URL}/functions/v1/paige-eval`;
const DB = process.env.SUPABASE_DB_URL || "";
const TENANT = "7e700000-0000-0000-0000-000000000007"; // the synthetic test workspace

const corpus = JSON.parse(readFileSync(join(HERE, "q0-corpus.json"), "utf8"));
const phase = (process.argv[2] ?? "").replace(/^--/, "");
const only = process.argv[3] ? process.argv[3].split(",") : null;
const cases = only ? corpus.cases.filter((c) => only.includes(c.id)) : corpus.cases;

const psql = (sql) => {
  const r = spawnSync("psql", ["-t", "-A", DB], { input: sql, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr?.slice(0, 400)}`);
  return r.stdout;
};
const evidencePath = (id) => {
  let p = join(EV, `${id}.json`);
  if (existsSync(p)) p = join(EV, `${id}.r${Date.now()}.json`);
  return p; // append-only: a re-run never overwrites the frozen before-state
};
const readEvidence = (id) => JSON.parse(readFileSync(join(EV, `${id}.json`), "utf8"));

async function session() {
  const { access_token } = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.Q0_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.Q0_EMAIL, password: process.env.Q0_PASSWORD }),
  })).json();
  if (!access_token) throw new Error("session mint failed");
  return access_token;
}

// ── phase: run ─────────────────────────────────────────────────────────────
async function runPhase() {
  mkdirSync(EV, { recursive: true });
  const tok = await session();
  const engineHead = execSync("git ls-remote origin refs/tags/edge-live").toString().trim().split("	")[0];
  for (const c of cases) {
    const t0 = Date.now();
    const resp = await fetch(ENGINE, {
      method: "POST",
      headers: { apikey: process.env.Q0_ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question: c.question, persist: true, caller: "q0-baseline", freshness_days: c.freshness_days, user_id: "680f28a9-6d80-4f43-a04d-5d625378b0ba" }),
    });
    const http = resp.status;
    const result = await resp.json().catch(() => null);
    const wallMs = Date.now() - t0;
    // the run's model-call evidence (provider/model/tier/cost per call) from the L1 trace
    let traces = [];
    if (result?.run_id) {
      try {
        traces = JSON.parse(psql(
          `select coalesce(json_agg(x),'[]'::json) from (select id, agent_id, provider, model, job_kind, tier, status, tokens_in, tokens_out, cost_estimate_usd, latency_ms, error_class, left(coalesce(input_excerpt,''),240) as input_excerpt, created_at from paige_llm_trace where task_id='${result.run_id}' order by created_at) x;`
        ));
      } catch { traces = []; }
    }
    const pack = {
      case_id: c.id, split: c.split, class: c.class, answer_class: c.answer_class,
      question: c.question, sub_questions: c.sub_questions, freshness_days: c.freshness_days,
      engine_head_at_run: engineHead, ran_at: new Date().toISOString(),
      http_status: http, wall_latency_ms: wallMs,
      engine_result: result, llm_traces: traces,
    };
    writeFileSync(evidencePath(c.id), JSON.stringify(pack, null, 2) + "\n");
    const cov = result?.coverage ?? {};
    console.log(`${c.id}: http=${http} stop=${cov.stop_reason ?? "?"} findings=${(result?.findings ?? []).length} sources=${(result?.sources ?? []).length} wall=${(wallMs / 1000).toFixed(1)}s`);
  }
}

// ── phase: metrics (deterministic only — no model calls) ───────────────────
function metricsPhase() {
  const eTLD = (u) => { try { const h = new URL(u).hostname; const p = h.split("."); return p.slice(-2).join("."); } catch { return u; } };
  for (const c of cases) {
    const pack = readEvidence(c.id);
    const r = pack.engine_result ?? {};
    const findings = Array.isArray(r.findings) ? r.findings : [];
    const sources = Array.isArray(r.sources) ? r.sources : [];
    const included = sources.filter((s) => !s.excluded);
    const citedIdx = new Set(findings.flatMap((f) => Array.isArray(f.citations) ? f.citations : []));
    const cited = included.filter((s) => citedIdx.has(s.index));
    const citedHosts = new Set(cited.map((s) => eTLD(s.url)));
    const m = {
      stop_reason: r.coverage?.stop_reason ?? null,
      configured: r.coverage?.configured !== false,
      findings_count: findings.length,
      sources_retrieved: sources.length,
      sources_included: included.length,
      sources_excluded: sources.length - included.length,
      sources_cited: cited.length,
      // authoritative-domain ratio: share of CITED sources on .gov/.edu/.mil/.int (T1)
      // or the case's own primary_domains (the domains the corpus author marked authoritative)
      primary_ratio: cited.length ? cited.filter((s) => {
        const e = eTLD(s.url);
        return e.endsWith(".gov") || e.endsWith(".edu") || e.endsWith(".mil") || e.endsWith(".int")
          || (c.primary_domains ?? []).some((d) => e === d || e.endsWith("." + d));
      }).length / cited.length : null,
      // independence: distinct eTLD+1 among cited sources, and the max share any one host holds
      citation_independence: cited.length ? Number((citedHosts.size / cited.length).toFixed(3)) : null,
      distinct_cited_hosts: citedHosts.size,
      // citation presence per finding (the engine drops uncited findings — expect exactly 1.0)
      findings_with_citations: findings.length ? findings.filter((f) => Array.isArray(f.citations) && f.citations.length > 0).length / findings.length : null,
      // unverified notes surfaced (the engine's own honesty channel)
      unverified_notes_count: Array.isArray(r.coverage?.unverified_notes) ? r.coverage.unverified_notes.length : 0,
      // freshness: newest published_at among CITED sources vs the case's freshness budget
      newest_cited_age_days: (() => {
        const dates = cited.map((s) => s.published_at ? Date.parse(s.published_at) : null).filter(Number.isFinite);
        if (!dates.length) return null;
        return Number(((Date.now() - Math.max(...dates)) / 86_400_000).toFixed(1));
      })(),
      freshness_budget_days: c.freshness_days,
      wall_latency_ms: pack.wall_latency_ms,
      // cost + routing from the L1 traces (the platform's own estimates)
      trace_cost_usd: Number((pack.llm_traces ?? []).reduce((a, t) => a + (t.cost_estimate_usd ?? 0), 0).toFixed(4)),
      engine_internal_cost_est_usd: (() => {
        const cov = r.coverage ?? {};
        const searches = Number(cov.searches ?? 0), reads = Number(cov.reads ?? 0), hops = Number(cov.hops_used ?? 0);
        const est = searches * 0.001 + reads * 0.0005 + Math.max(hops, 1) * 0.002 + 0.03;
        return Number(est.toFixed(4));
      })(),
      trace_models: [...new Set((pack.llm_traces ?? []).map((t) => `${t.provider}/${t.model}/${t.job_kind}`))],
      trace_call_count: (pack.llm_traces ?? []).length,
      // insufficiency behavior (deterministic half): findings empty + honest stop, or findings present
      empty_findings_honest_stop: findings.length === 0 && ["no_results", "unconfigured", "budget", "wall_clock"].includes(r.coverage?.stop_reason ?? ""),
    };
    pack.deterministic_metrics = m;
    // rewrite the SAME pack in place for metrics/judge phases (the run evidence above is untouched)
    writeFileSync(join(EV, `${c.id}.json`), JSON.stringify(pack, null, 2) + "\n");
    console.log(`${c.id}: stop=${m.stop_reason} cited=${m.sources_cited} primary=${m.primary_ratio} indep=${m.citation_independence} cost=$${m.trace_cost_usd}`);
  }
}

// ── phase: seed + judge (the canonical substrate) ──────────────────────────
const RUBRICS = {
  entailment: (c) => `You are auditing research findings for citation entailment. For EACH finding, check whether its cited sources (indexed [n], text provided) actually contain the factual content the finding states. Score 1.0 only if every finding is directly supported by the specific sources it cites; score proportionally lower for any finding whose citation does not contain its claim (a citation that is merely topically related does NOT count). If the run produced NO findings, return {"score": 1.0, "rationale": "no findings produced; nothing mis-cited"}. Return ONLY JSON {"score": <0..1>, "rationale": "<one sentence citing which finding(s) failed, if any>"}.`,
  precision: (c) => `You are auditing source retrieval precision. The research question is given, then the INCLUDED (non-excluded) retrieved sources with titles+snippets. Score the share of sources genuinely relevant to answering THIS question (topically on-point, not merely same-industry or SEO-adjacent). 1.0 = essentially all relevant; 0.3 = mostly noise. Return ONLY JSON {"score": <0..1>, "rationale": "<one sentence>"}.`,
  completeness: (c) => `You are auditing answer completeness. The research question and its REQUIRED sub-questions are listed, then the findings the research system produced. Score 1.0 only if every sub-question is addressed by at least one finding (or explicitly marked unaddressed by the run's own notes); score the addressed share otherwise. A missing sub-question that the run explicitly flags as unresolved counts as addressed-honestly (half credit each, i.e. score = addressed + 0.5*explicitly_unresolved over total). Return ONLY JSON {"score": <0..1>, "rationale": "<which sub-questions were missed>"}.`,
  contradiction: (c) => `You are auditing contradiction surfacing. This case is a CONTESTED question where credible sources genuinely disagree. Given the findings and source texts, score 1.0 if the output clearly SURFACES the disagreement (reports the range/conflict and ideally why it exists); 0.0 if it silently picks one side or reports a single figure as settled; 0.5 if it hints at variation without naming it. Return ONLY JSON {"score": <0..1>, "rationale": "<one sentence>"}.`,
  insufficiency: (c) => `You are auditing honest-insufficiency behavior. This case's correct outcome is that credible public evidence does NOT establish the requested fact. Given the findings/notes, score 1.0 if the output refuses to assert the unsupported fact and clearly states insufficiency; 0.0 if it asserts the fact anyway or gives a confident-sounding fabricated/estimated figure as an answer; 0.5 if it hedges but still implies a figure. Return ONLY JSON {"score": <0..1>, "rationale": "<one sentence>"}.`,
};

async function seedPhase() {
  const tok = await session();
  const metricSets = {
    q0_entailment: { rubric: RUBRICS.entailment, filter: () => true },
    q0_precision: { rubric: RUBRICS.precision, filter: () => true },
    q0_completeness: { rubric: RUBRICS.completeness, filter: () => true },
    q0_contradiction: { rubric: RUBRICS.contradiction, filter: (c) => c.class === "contested" },
    q0_insufficiency: { rubric: RUBRICS.insufficiency, filter: (c) => c.answer_class === "insufficient" || c.answer_class === "judgment" },
  };
  for (const [name, ms] of Object.entries(metricSets)) {
    const dsId = psql(`insert into paige_eval_dataset (tenant_id, name, description, target_kind, target_ref) values ('${TENANT}', '${name}-v1', 'INT-322 Q0 frozen baseline', 'trace_batch', '${name}-v1') returning id;`).match(/[0-9a-f-]{36}/)[0];
    for (const c of cases.filter(ms.filter)) {
      const pack = readEvidence(c.id);
      const output = {
        case_id: c.id, question: c.question, sub_questions: c.sub_questions,
        findings: pack.engine_result?.findings ?? [],
        sources_included: (pack.engine_result?.sources ?? []).filter((s) => !s.excluded).map((s) => ({ index: s.index, url: s.url, title: s.title, snippet: (s.snippet ?? "").slice(0, 600) })),
        coverage: pack.engine_result?.coverage ?? {},
      };
      const sqlIns = "insert into paige_eval_case (dataset_id, tenant_id, input, rubric, metadata) values ('" + dsId + "', '" + TENANT + "', '" + JSON.stringify(output).replaceAll("'", "''") + "'::jsonb, '" + JSON.stringify(ms.rubric(c)).replaceAll("'", "''") + "', '" + JSON.stringify({ q0_case: c.id, class: c.class, split: c.split }).replaceAll("'", "''") + "'::jsonb);";
      psql(sqlIns);
    }
    // run the governed judge over the dataset
    const resp = await fetch(EVAL, {
      method: "POST",
      headers: { apikey: process.env.Q0_ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: dsId, scorers: ["rubric_judge"] }),
    });
    const body = await resp.json().catch(() => ({}));
    console.log(`${name}: dataset=${dsId} http=${resp.status} ok=${body.ok} scored=${body.result?.scored_count} aggregate=${body.result?.aggregate_score}`);
  }
}

// ── phase: rescore-v2 — re-score the FROZEN Q0 packs with the corrected judge ──
async function rescorePhase() {
  const tok = await session();
  const metricSets = {
    q0_entailment: { rubric: RUBRICS.entailment, filter: () => true },
    q0_precision: { rubric: RUBRICS.precision, filter: () => true },
    q0_completeness: { rubric: RUBRICS.completeness, filter: () => true },
    q0_contradiction: { rubric: RUBRICS.contradiction, filter: (c) => c.class === "contested" },
    q0_insufficiency: { rubric: RUBRICS.insufficiency, filter: (c) => c.answer_class === "insufficient" || c.answer_class === "judgment" },
  };
  for (const [name, ms] of Object.entries(metricSets)) {
    const dsId = psql(`insert into paige_eval_dataset (tenant_id, name, description, target_kind, target_ref) values ('${TENANT}', '${name}-v2', 'INT-322 R3 corrected-judge re-score of the frozen Q0 evidence', 'trace_batch', '${name}-v2') returning id;`).match(/[0-9a-f-]{36}/)[0];
    for (const c of cases.filter(ms.filter)) {
      const pack = readEvidence(c.id);
      const output = {
        case_id: c.id, question: c.question, sub_questions: c.sub_questions,
        findings: pack.engine_result?.findings ?? [],
        sources_included: (pack.engine_result?.sources ?? []).filter((x) => !x.excluded).map((x) => ({ index: x.index, url: x.url, title: x.title, snippet: (x.snippet ?? "").slice(0, 600) })),
        coverage: pack.engine_result?.coverage ?? {},
      };
      const sqlIns = "insert into paige_eval_case (dataset_id, tenant_id, input, rubric, metadata) values ('" + dsId + "', '" + TENANT + "', '" + JSON.stringify(output).replaceAll("'", "''") + "'::jsonb, '" + JSON.stringify(ms.rubric(c)).replaceAll("'", "''") + "', '" + JSON.stringify({ q0_case: c.id, class: c.class, split: c.split, judge: "v2" }).replaceAll("'", "''") + "'::jsonb);";
      psql(sqlIns);
    }
    const resp = await fetch(EVAL, {
      method: "POST",
      headers: { apikey: process.env.Q0_ANON_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: dsId, scorers: ["rubric_judge_v2"] }),
    });
    const body = await resp.json().catch(() => ({}));
    console.log(`${name}-v2: dataset=${dsId} http=${resp.status} ok=${body.ok} scored=${body.result?.scored_count}`);
  }
}

// ── phase: report ──────────────────────────────────────────────────────────
async function reportPhase() {
  // pull ALL q0 judge results from the canonical store
  // metric name comes from the dataset ref
  const rows2 = JSON.parse(psql(`select coalesce(json_agg(x),'[]'::json) from (
    select ds.target_ref as metric, r.scorer as judge_version, c.metadata->>'q0_case' as q0_case, r.score, r.status, r.rationale, r.judge_model, r.cost_estimate_usd
    from paige_eval_result r
    join paige_eval_case c on c.id = r.case_id
    join paige_eval_dataset ds on ds.id = c.dataset_id
    where ds.target_ref like 'q0_%'
  ) x;`));
  const agg = { generated_at: new Date().toISOString(), per_case: [], aggregate: {} };
  for (const c of corpus.cases) {
    const pack = readEvidence(c.id);
    const judges = {};
    for (const r of rows2.filter((x) => x.q0_case === c.id)) judges[r.metric] = { score: r.score, status: r.status, rationale: r.rationale, judge_model: r.judge_model };
    agg.per_case.push({ case_id: c.id, split: c.split, class: c.class, answer_class: c.answer_class, deterministic: pack.deterministic_metrics, judges });
  }
  const avg = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : null; };
  for (const split of ["dev", "holdout", "all"]) {
    const set = agg.per_case.filter((p) => split === "all" || p.split === split);
    agg.aggregate[split] = {
      n: set.length,
      judge_entailment: avg(set.map((p) => (p.judges["q0_entailment-v1"] ?? p.judges.entailment_v1)?.score)),
      judge_v2_entailment: avg(set.map((p) => p.judges["q0_entailment-v2"]?.score)),
      judge_v2_precision: avg(set.map((p) => p.judges["q0_precision-v2"]?.score)),
      judge_v2_completeness: avg(set.map((p) => p.judges["q0_completeness-v2"]?.score)),
      judge_v2_contradiction: avg(set.filter((p) => p.judges["q0_contradiction-v2"]).map((p) => p.judges["q0_contradiction-v2"]?.score)),
      judge_v2_insufficiency: avg(set.filter((p) => p.judges["q0_insufficiency-v2"]).map((p) => p.judges["q0_insufficiency-v2"]?.score)),
      judge_v2_cost_usd: Number(rows2.filter((r) => r.judge_version === "rubric_judge_v2" && set.some((x) => x.case_id === r.q0_case)).reduce((a2, r) => a2 + (r.cost_estimate_usd ?? 0), 0).toFixed(4)),
      parse_degradation_v2: (() => { const rs = rows2.filter((r) => r.judge_version === "rubric_judge_v2" && set.some((x) => x.case_id === r.q0_case)); return rs.length ? Number((rs.filter((r) => r.status !== "scored").length / rs.length).toFixed(3)) : null; })(),
      judge_precision: avg(set.map((p) => p.judges["q0_precision-v1"]?.score)),
      judge_completeness: avg(set.map((p) => p.judges["q0_completeness-v1"]?.score)),
      judge_contradiction: avg(set.filter((p) => p.judges["q0_contradiction-v1"]).map((p) => p.judges["q0_contradiction-v1"]?.score)),
      judge_insufficiency: avg(set.filter((p) => p.judges["q0_insufficiency-v1"]).map((p) => p.judges["q0_insufficiency-v1"]?.score)),
      primary_ratio: avg(set.map((p) => p.deterministic?.primary_ratio)),
      citation_independence: avg(set.map((p) => p.deterministic?.citation_independence)),
      findings_with_citations: avg(set.map((p) => p.deterministic?.findings_with_citations)),
      empty_findings_rate: Number((set.filter((p) => p.deterministic?.findings_count === 0).length / set.length).toFixed(3)),
      median_wall_latency_ms: (() => { const xs = set.map((p) => p.deterministic?.wall_latency_ms).filter(Number.isFinite).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; })(),
      total_trace_cost_usd: Number(set.reduce((a, p) => a + (p.deterministic?.trace_cost_usd ?? 0), 0).toFixed(4)),
      total_judge_cost_usd: Number(rows2.filter((r) => r.judge_version !== "rubric_judge_v2" && set.some((s) => s.case_id === r.q0_case)).reduce((a, r) => a + (r.cost_estimate_usd ?? 0), 0).toFixed(4)),
    };
  }
  writeFileSync(join(ROOT, "docs", "research-quality", "q0", "baseline.json"), JSON.stringify(agg, null, 2) + "\n");
  console.log(JSON.stringify(agg.aggregate.dev, null, 2));
}

switch (phase) {
  case "run": await runPhase(); break;
  case "metrics": metricsPhase(); break;
  case "seed": await seedPhase(); break;
  case "report": await reportPhase(); break;
  case "rescore": await rescorePhase(); break;
  default: console.error("usage: q0-run.mjs <run|metrics|seed|report|rescore> [caseIds]"); process.exit(1);
}
