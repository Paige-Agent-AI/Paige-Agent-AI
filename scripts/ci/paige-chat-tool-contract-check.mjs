#!/usr/bin/env node
/**
 * INT-080 — exercise the real paige-ai-chat handler as an authenticated standalone Solo owner,
 * capture the exact Anthropic-native tools array, and reject provider-incompatible definitions.
 * All provider/database boundaries are local fakes; this check cannot call a real provider.
 */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The check imports the real paige-ai-chat handler, a Deno module graph (TypeScript with parameter
// properties, https: and npm: specifiers). Node can load it only through the repository's offline
// loader. Run bare — as the INT-080 evidence record documents — this used to crash on an unrelated
// file (`_shared/n8n-management.ts`: "parameter property is not supported in strip-only mode")
// before a single check ran. Register the loader ourselves, once: re-exec under it with an env
// sentinel (the pattern capability-declaration-lint.mjs uses), unless the caller already passed it
// on the command line, as tool-catalogue-lint.mjs does. The sentinel also covers a loader supplied
// through NODE_OPTIONS or a path spelled another way, so the child can never re-exec again.
const LOADER = new URL("../knowledge-scope/register.mjs", import.meta.url);
const loaderOnArgv = process.execArgv.some((a) => a.replaceAll("\\", "/").includes("knowledge-scope/register.mjs"));
if (!process.env.__TOOL_CONTRACT_LOADER && !loaderOnArgv) {
  const child = spawnSync(process.execPath, ["--import", LOADER.href, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, __TOOL_CONTRACT_LOADER: "1" },
  });
  if (child.error) console.error(`contract check could not start under the loader: ${child.error.message}`);
  else if (child.signal) console.error(`contract check was killed by ${child.signal}`);
  process.exit(child.error || child.signal ? 1 : child.status ?? 1);
}

const SOLO = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const VECTOR = Array.from({ length: 1024 }, (_, index) => (index % 7) / 10);

let checks = 0;
let failures = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`         ${detail}`);
  }
}

globalThis.Deno = {
  env: {
    get: (key) => ({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      VOYAGE_API_KEY: "test-voyage-key",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    })[key] ?? "",
  },
};

let providerMode = "text";
let providerCalls = [];
globalThis.fetch = async (input, init) => {
  const href = String(input);
  if (href.includes("voyageai.com")) {
    return new Response(JSON.stringify({ data: [{ index: 0, embedding: VECTOR }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (href === "https://api.anthropic.com/v1/messages") {
    providerCalls.push(JSON.parse(String(init?.body ?? "{}")));
    if (providerMode === "contract-400") {
      const providerError = JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "tools.34.custom.input_schema: invalid JSON schema; top-level anyOf is not supported. PRIVATE-TENANT-MARKER owner@example.test sk-ant-THIS_MUST_NOT_SURVIVE",
        },
      // Valid JSON permits trailing whitespace. Make the wire body exceed the capture cap so this
      // same case proves the adapter stops reading while retaining the small structural prefix.
      }) + " ".repeat(6000);
      return new Response(providerError, {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "request-id": "req_int080_contract_fixture",
        },
      });
    }
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Scoped response." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  throw new Error(`INT-080 offline check blocked unexpected network call: ${href}`);
};

const fake = await import("../knowledge-scope/fake-supabase.mjs");
await import("../../supabase/functions/paige-ai-chat/index.ts");
const { capturedHandler } = await import("../knowledge-scope/stub-serve.mjs");
const handler = capturedHandler();

async function drive(mode) {
  providerMode = mode;
  providerCalls = [];
  const rec = fake.setScenario({
    authUser: { id: USER, email: "owner@example.test" },
    rpcs: {
      check_rate_limit: { data: true, error: null },
      get_actor_access: { data: { tier: "tenant" }, error: null },
      get_paige_persona_context: {
        data: [{
          tenant_id: SOLO,
          tenant_name: "Disposable Solo",
          playbook_config: null,
          playbook_slug: null,
          funding_enabled: false,
          brand: null,
        }],
        error: null,
      },
      match_tenant_knowledge: { data: [], error: null },
      match_rag_documents: { data: [], error: null },
      resolve_tool_autonomy: { data: "confirm", error: null },
    },
    tables: {
      profiles: [{ active_tenant_id: SOLO }],
      tenant_members: [{ tenant_id: SOLO, user_id: USER, status: "active" }],
      user_roles: [{ role: "admin" }],
      paige_departments: [],
    },
  });

  const logged = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => logged.push(args.join(" "));
  console.warn = (...args) => logged.push(args.join(" "));
  let response;
  try {
    response = await handler(new Request("http://local/paige-ai-chat", {
      method: "POST",
      headers: { Authorization: "Bearer test-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hey can you do a systems check on this account?" }],
      }),
    }));
    await response.text();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  return { rec, response, providerCalls: [...providerCalls], logged };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const namePattern = /^[a-zA-Z0-9_-]{1,64}$/;
const topLevelCombinators = new Set(["oneOf", "anyOf", "allOf"]);
const supportedKeywords = new Set([
  "$anchor", "$comment", "$defs", "$dynamicAnchor", "$dynamicRef", "$id", "$ref", "$schema", "$vocabulary",
  "additionalProperties", "allOf", "anyOf", "const", "contains", "contentEncoding", "contentMediaType", "contentSchema",
  "default", "dependentRequired", "dependentSchemas", "deprecated", "description", "else", "enum", "examples",
  "exclusiveMaximum", "exclusiveMinimum", "format", "if", "items", "maxContains", "maximum", "maxItems", "maxLength",
  "maxProperties", "minContains", "minimum", "minItems", "minLength", "minProperties", "multipleOf", "not", "oneOf",
  "pattern", "patternProperties", "prefixItems", "properties", "propertyNames", "readOnly", "required", "then", "title",
  "type", "unevaluatedItems", "unevaluatedProperties", "uniqueItems", "writeOnly",
]);

function validateSchemaNode(schema, pathLabel, findings, inheritedProperties = null) {
  if (typeof schema === "boolean") return;
  if (!isObject(schema)) {
    findings.push(`${pathLabel}: schema node must be an object or boolean`);
    return;
  }
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) findings.push(`${pathLabel}: unsupported keyword ${keyword}`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string")) {
      findings.push(`${pathLabel}.required: must be an array of strings`);
    } else {
      const duplicates = schema.required.filter((item, index) => schema.required.indexOf(item) !== index);
      for (const duplicate of new Set(duplicates)) findings.push(`${pathLabel}.required: duplicate ${duplicate}`);
      const properties = isObject(schema.properties) ? schema.properties : inheritedProperties;
      if (properties) {
        for (const field of schema.required) {
          if (!Object.hasOwn(properties, field)) findings.push(`${pathLabel}.required: ${field} is absent from properties`);
        }
      }
    }
  }
  const availableProperties = isObject(schema.properties) ? schema.properties : inheritedProperties;
  if (isObject(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      validateSchemaNode(child, `${pathLabel}.properties.${name}`, findings, null);
    }
  }
  if (isObject(schema.patternProperties)) {
    for (const [name, child] of Object.entries(schema.patternProperties)) {
      validateSchemaNode(child, `${pathLabel}.patternProperties.${name}`, findings, null);
    }
  }
  for (const keyword of ["additionalProperties", "propertyNames", "contains", "not", "if", "then", "else", "unevaluatedProperties", "unevaluatedItems", "contentSchema"]) {
    if (isObject(schema[keyword]) || typeof schema[keyword] === "boolean") {
      validateSchemaNode(schema[keyword], `${pathLabel}.${keyword}`, findings, availableProperties);
    }
  }
  if (isObject(schema.items) || typeof schema.items === "boolean") {
    validateSchemaNode(schema.items, `${pathLabel}.items`, findings, null);
  }
  for (const keyword of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword].forEach((child, index) =>
        validateSchemaNode(child, `${pathLabel}.${keyword}[${index}]`, findings, availableProperties));
    }
  }
  for (const keyword of ["$defs", "dependentSchemas"]) {
    if (isObject(schema[keyword])) {
      for (const [name, child] of Object.entries(schema[keyword])) {
        validateSchemaNode(child, `${pathLabel}.${keyword}.${name}`, findings, null);
      }
    }
  }
}

console.log("INT-080 exact standalone-owner manifest");
const manifestRun = await drive("text");
const tools = manifestRun.providerCalls[0]?.tools;
check("one provider request carries the emitted tools array",
  manifestRun.providerCalls.length === 1 && Array.isArray(tools) && tools.length > 0,
  `provider calls ${manifestRun.providerCalls.length}; tools ${Array.isArray(tools) ? tools.length : "missing"}`);

const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });
addFormats(ajv);
const findings = [];
const toolSizes = [];
for (const tool of Array.isArray(tools) ? tools : []) {
  const toolFindings = [];
  const name = typeof tool?.name === "string" ? tool.name : "<missing-name>";
  if (!namePattern.test(name)) toolFindings.push(`name does not match ${namePattern}`);
  if (typeof tool?.description !== "string" || tool.description.trim().length === 0) toolFindings.push("description is missing or empty");
  const schema = tool?.input_schema;
  if (!isObject(schema)) toolFindings.push("input_schema must be an object");
  else {
    if (schema.type !== "object") toolFindings.push(`input_schema.type must be object; got ${JSON.stringify(schema.type)}`);
    for (const keyword of topLevelCombinators) if (Object.hasOwn(schema, keyword)) toolFindings.push(`top-level ${keyword} is forbidden`);
    validateSchemaNode(schema, `${name}.input_schema`, toolFindings);
    try {
      if (!ajv.validateSchema(schema)) toolFindings.push(`invalid JSON Schema: ${ajv.errorsText(ajv.errors, { separator: "; " })}`);
      else ajv.compile(schema);
    } catch (error) {
      toolFindings.push(`invalid JSON Schema: ${error?.message ?? error}`);
    }
  }
  toolSizes.push([name, Buffer.byteLength(JSON.stringify(tool))]);
  for (const finding of toolFindings) findings.push(`${name}: ${finding}`);
}
const names = toolSizes.map(([name]) => name);
for (const name of new Set(names.filter((candidate, index) => names.indexOf(candidate) !== index))) findings.push(`${name}: duplicate tool name`);
const manifestBytes = Buffer.byteLength(JSON.stringify(tools ?? []));
console.log(`  stats ${JSON.stringify({ tools: toolSizes.length, bytes: manifestBytes, per_tool_bytes: Object.fromEntries(toolSizes) })}`);
check("every emitted tool satisfies the Anthropic tool and JSON Schema contract", findings.length === 0, findings.join("\n         "));

const { CRM_COMMAND_TOOL_NAMES } = await import("../../supabase/functions/_shared/crm-command/catalog.ts");
const emittedNames = new Set(names);
const missingCrmCommands = [...CRM_COMMAND_TOOL_NAMES].filter((name) => !emittedNames.has(name));
check("all 32 governed CRM command tools remain in the manifest",
  CRM_COMMAND_TOOL_NAMES.size === 32 && missingCrmCommands.length === 0,
  `catalog ${CRM_COMMAND_TOOL_NAMES.size}; missing ${missingCrmCommands.join(", ") || "none"}`);

console.log("\nINT-080 rejected provider request");
const rejected = await drive("contract-400");
const errorTrace = rejected.rec.inserts
  .filter((insert) => insert.table === "paige_llm_trace" && insert.row?.status === "error")
  .at(-1)?.row;
let errorDetail = null;
try { errorDetail = JSON.parse(errorTrace?.error_message ?? ""); } catch { /* failing-first */ }
check("upstream 400 remains an error, never a completed turn",
  rejected.response?.status === 500 && rejected.providerCalls.length === 1,
  `status ${rejected.response?.status}; provider calls ${rejected.providerCalls.length}`);
check("upstream 400 writes an attributed error trace",
  errorTrace?.status === "error" && errorTrace?.error_class === "http_400" && errorTrace?.tenant_id === SOLO,
  JSON.stringify(errorTrace ?? null));
check("trace preserves bounded structural detail and Anthropic request ID",
  errorDetail?.provider_request_id === "req_int080_contract_fixture"
    && errorDetail?.error_type === "invalid_request_error"
    && errorDetail?.error_path === "tools.34.custom.input_schema"
    && errorDetail?.issue_codes?.includes("top_level_anyof")
    && errorDetail?.issue_codes?.includes("invalid_json_schema")
    && errorDetail?.captured_bytes === 4096
    && errorDetail?.truncated === true
    && typeof errorTrace?.error_message === "string"
    && errorTrace.error_message.length <= 1024,
  JSON.stringify(errorTrace?.error_message ?? null));
check("diagnostics retain no tenant content, email, or provider key material",
  typeof errorTrace?.error_message === "string"
    && !errorTrace.error_message.includes("PRIVATE-TENANT-MARKER")
    && !errorTrace.error_message.includes("owner@example.test")
    && !errorTrace.error_message.includes("sk-ant-THIS_MUST_NOT_SURVIVE"),
  JSON.stringify(errorTrace?.error_message ?? null));
check("upstream 400 cannot enter tool dispatch", rejected.rec.functions.length === 0, JSON.stringify(rejected.rec.functions));

// The provider schema cannot express deal.update's "one of these reversible fields" invariant
// without a forbidden top-level combinator. Pin the existing authoritative executor validation so
// removing the duplicate provider constraint cannot turn an empty update into an executable write.
await import("../../supabase/functions/crm-command/index.ts");
const crmHandler = capturedHandler();
const crmRecorder = fake.setScenario({ authUser: { id: USER, email: "owner@example.test" } });
const emptyDealUpdate = await crmHandler(new Request("http://local/crm-command", {
  method: "POST",
  headers: { Authorization: "Bearer test-jwt", "Content-Type": "application/json" },
  body: JSON.stringify({
    command: {
      action: "deal.update",
      deal_id: "55555555-5555-4555-8555-555555555555",
      expected_version: 1,
    },
    idempotency_key: "int080-empty-deal-update",
  }),
}));
const emptyDealBody = await emptyDealUpdate.json();
check("executor still rejects deal.update with no reversible field before any RPC or write",
  emptyDealUpdate.status === 400
    && emptyDealBody?.code === "CRM_COMMAND_INVALID"
    && crmRecorder.rpc.length === 0
    && crmRecorder.inserts.length === 0,
  JSON.stringify({ status: emptyDealUpdate.status, body: emptyDealBody, rpc: crmRecorder.rpc, inserts: crmRecorder.inserts }));

console.log(`\n${checks - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
