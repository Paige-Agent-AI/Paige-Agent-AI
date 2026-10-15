// Build-time AST proof of incumbent CRM service reads and Pipeline preparations.
// This grants no executor, tenant, seat or approval authority at runtime.
import ts from "typescript";
import { readFileSync } from "node:fs";
const visit = (node, pred) => { const out = []; const walk = n => { if (pred(n)) out.push(n); ts.forEachChild(n, walk); }; walk(node); return out; };
const text = n => n?.getText().replace(/\s/g, "") ?? "";
const id = n => n && ts.isIdentifier(n) ? n.text : "";
const str = n => n && ts.isStringLiteral(n) ? n.text : null;
const method = n => ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : "";
const root = n => (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isPropertyAccessExpression(n)
  || ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isNonNullExpression(n)) ? root(n.expression) : id(n);
const specs = new Map([
  ["crm_search_contacts", ["crm_clients.search_contacts", "clients"]],
  ["crm_get_contact_summary", ["crm_clients.contact_summary", "clients"]],
  ["crm_list_tasks", ["crm_clients.list_tasks", "tasks"]],
  ["crm_list_deals", ["sales.crm_list_deals", "deals"]],
  ["crm_pipeline_summary", ["sales.crm_pipeline_summary", "clients"]],
]);
const readMethods = new Set(["from", "select", "eq", "neq", "order", "limit", "maybeSingle", "contains", "lt", "gte", "lte", "in", "is"]);
const pureMethods = new Set(["map", "filter", "find", "toLowerCase", "join", "slice", "toISOString"]);
const helpers = new Map([
  ["orderedContactMethods", "../_shared/contact-methods.ts"],
  ["contactIdsByAddressToken", "../_shared/contact-search.ts"],
  ["applyContactSearchFilter", "../_shared/contact-search.ts"],
  ["projectDealRelationshipIntegrity", "../_shared/crm-command/deal-relationship-integrity.ts"],
  ["readPipelineWorkspace", "../_shared/pipelineWorkspaceRead.ts"],
]);
const scopedChain = (call) => {
  let n = call;
  while (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && ts.isCallExpression(n.parent.parent)) n = n.parent.parent;
  return visit(n, ts.isCallExpression);
};
const dependencySpecs = [
  ["contact-search.ts", ["contactIdsByAddressToken", "applyContactSearchFilter"]],
  ["client-ref.ts", ["resolveClientRef"]],
  ["contact-methods.ts", ["orderedContactMethods"]],
  ["crm-command/deal-relationship-integrity.ts", ["projectDealRelationshipIntegrity"]],
  ["pipelineWorkspaceRead.ts", ["readPipelineWorkspace"]],
];
const dependencies = () => Object.fromEntries(dependencySpecs.map(([file]) => [file,
  readFileSync(new URL(`../../supabase/functions/_shared/${file}`, import.meta.url), "utf8")]));
function validateDependencies(sources, require) {
  const pure = new Set(["replace", "trim", "split", "map", "filter", "flatMap", "slice", "join", "push", "get", "set", "has", "add", "sort", "some", "includes", "normalize", "toLocaleLowerCase", "toUpperCase", "test", "isInteger"]);
  for (const [file, entries] of dependencySpecs) {
    const source = ts.createSourceFile(file, sources[file] ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    require(!!sources[file] && !source.parseDiagnostics.length, `${file}: dependency parses`);
    const funcs = new Map();
    for (const n of visit(source, n => ts.isFunctionDeclaration(n) || (ts.isVariableDeclaration(n) && n.initializer && ts.isArrowFunction(n.initializer)))) {
      require(!funcs.has(id(n.name)), `${file}: no duplicate function ${id(n.name)}`);
      funcs.set(id(n.name), ts.isFunctionDeclaration(n) ? n : n.initializer);
    }
    const visited = new Set();
    const check = name => {
      if (visited.has(name)) return;
      visited.add(name);
      const fn = funcs.get(name);
      require(!!fn, `${file}: canonical helper ${name}`);
      if (!fn) return;
      const locals = new Set(visit(fn, n => ts.isVariableDeclaration(n) || ts.isParameter(n)).flatMap(n => visit(n.name, ts.isIdentifier).map(id)));
      require(!["String", "Array", "Number", "Date", "console"].some(n => locals.has(n)), `${file}: builtins are unshadowed`);
      for (const call of visit(fn, ts.isCallExpression)) {
        const called = text(call.expression), r = root(call.expression), m = method(call);
        if (funcs.has(called)) { check(called); continue; }
        let safe = ["String", "Number", "Array.isArray", "Number.isSafeInteger", "Number.isFinite", "Date.parse", "console.error", "console.warn"].includes(called)
          || (pure.has(m) && (!r || r === "String" || locals.has(r)));
        if (r === "admin") safe = readMethods.has(m) || m === "or";
        if (["query", "q"].includes(r)) safe = readMethods.has(m) || m === "or";
        if (called === "callerRpc") safe = file === "pipelineWorkspaceRead.ts" && ["current_user_tenant_id", "get_pipeline_workspace"].includes(str(call.arguments[0]));
        require(safe, `${file}: reachable unknown/effectful call ${called}`);
      }
      require(visit(fn, ts.isNewExpression).every(n => ["Map", "Set"].includes(id(n.expression))), `${file}: no effectful constructor`);
    };
    for (const entry of entries) check(entry);
    if (file === "client-ref.ts") {
      const fn = funcs.get("resolveClientRef");
      require(!!fn && visit(fn, n => ts.isCallExpression(n) && method(n) === "eq" && str(n.arguments[0]) === "tenant_id" && id(n.arguments[1]) === "tenantId").length === 1, "client reference lookup stays tenant-pinned");
    }
    if (file === "contact-search.ts") {
      const fn = funcs.get("contactIdsByAddressToken");
      require(!!fn && visit(fn, n => ts.isCallExpression(n) && method(n) === "eq" && str(n.arguments[0]) === "tenant_id" && id(n.arguments[1]) === "tenantId").length === 1, "address lookup retains tenant filter");
    }
  }
}

function inspectCrmReadBindings(chatText, dependencySources) {
  const chat = ts.createSourceFile("chat.ts", chatText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [], tools = new Map();
  const require = (ok, message) => { if (!ok) findings.push(`CRM read binding: ${message}`); };
  validateDependencies(dependencySources, require);
  require(!chat.parseDiagnostics.length, "source parses");
  const decls = name => visit(chat, n => (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n)) && id(n.name) === name);
  for (const [name, source] of helpers) {
    const imports = visit(chat, ts.isImportDeclaration).filter(n => str(n.moduleSpecifier) === source);
    require(imports.length === 1 && imports[0].importClause?.namedBindings && ts.isNamedImports(imports[0].importClause.namedBindings)
      && imports[0].importClause.namedBindings.elements.some(e => id(e.name) === name && !e.propertyName) && !decls(name).length, `canonical unshadowed ${name} import`);
  }
  const tenants = decls("crmTenantId").filter(ts.isVariableDeclaration);
  require(tenants.length === 1 && text(tenants[0].initializer) === "personaCtx.tenant_id", "tenant is server persona scope");
  const refused = visit(chat, n => ts.isIfStatement(n) && text(n.expression) === "CRM_SERVICE_TOOLS.has(tc.function.name)&&!crmTenantId");
  require(refused.length === 1 && visit(refused[0].thenStatement, ts.isContinueStatement).length === 1, "missing tenant refuses before dispatch");
  const checks = decls("bindingRefusal").filter(n => n.initializer && text(n.initializer) === "awaitcrmWorkspaceBindingRefusal(crmTenantId)");
  require(checks.length === 1 && visit(checks[0].parent.parent.parent, n => ts.isIfStatement(n) && text(n.expression) === "bindingRefusal"
    && visit(n.thenStatement, ts.isContinueStatement).length === 1).length === 1, "caller workspace refusal before dispatch");
  const refusal = decls("crmWorkspaceBindingRefusal").filter(ts.isVariableDeclaration);
  require(refusal.length === 1 && text(refusal[0].initializer.body) === '{constown=awaitreadCallerOwnTenant();if(own.failed||!own.tenant||own.tenant!==crmTenantId)returnown.failed?"workspace_check_failed":"workspace_mismatch";returnnull;}', "workspace refusal fails closed on error, missing scope and mismatch");
  const own = decls("readCallerOwnTenant").filter(ts.isVariableDeclaration);
  require(own.length === 1 && visit(own[0], n => ts.isCallExpression(n) && text(n.expression) === "supabaseClient.rpc" && str(n.arguments[0]) === "current_user_tenant_id").length === 1
    && visit(own[0], n => ts.isReturnStatement(n) && text(n.expression) === "{tenant:(ownTenantasstring|null)??null,failed:!!ownTenantErr}").length === 1, "fresh caller-JWT tenant/error projection");
  require(visit(chat, n => ts.isBinaryExpression(n) && text(n) === "callerOwnTenantMemo=null").length === 1, "scope memo is reset per tool call");
  const serviceSet = decls("CRM_SERVICE_TOOLS")[0];
  require(!!serviceSet && [...specs.keys()].every(tool => visit(serviceSet, n => ts.isStringLiteral(n) && n.text === tool).length === 1), "all reads use incumbent service scope guard");
  for (const [tool, [key, primaryTable]] of specs) {
    const branches = visit(chat, n => ts.isIfStatement(n) && text(n.expression) === `tc.function.name==="${tool}"`);
    require(branches.length === 1, `${tool}: exact dispatch branch`);
    if (branches.length !== 1) continue;
    const body = branches[0].thenStatement, calls = visit(body, ts.isCallExpression);
    let scope = branches[0].parent;
    while (scope && !ts.isBlock(scope)) scope = scope.parent;
    const admins = scope ? scope.statements.flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations].filter(n => id(n.name) === "admin") : []) : [];
    require(admins.length === 1 && text(admins[0].initializer) === "createClient(supabaseUrl,supabaseServiceKey)", `${tool}: actual server client`);
    require(tenants[0]?.pos < branches[0].pos && refused[0]?.pos < branches[0].pos && checks[0]?.pos < branches[0].pos, `${tool}: guards dominate dispatch`);
    require(!visit(body, n => (ts.isVariableDeclaration(n) || ts.isParameter(n)) && ["admin", "crmTenantId", "Math", "Date", "Promise", "Number", "String", "Boolean", ...helpers.keys()].includes(id(n.name))).length, `${tool}: trusted bindings cannot be shadowed`);
    require(!visit(body, n => ts.isBinaryExpression(n) && ["admin", "crmTenantId"].includes(id(n.left))).length, `${tool}: trusted bindings cannot be reassigned`);
    const reads = calls.filter(c => root(c.expression) === "admin" && method(c) === "from");
    require(reads.some(c => str(c.arguments[0]) === primaryTable), `${tool}: real primary read`);
    for (const from of reads) {
      const table = str(from.arguments[0]), chain = scopedChain(from);
      const tenant = chain.some(c => method(c) === "eq" && str(c.arguments[0]) === "tenant_id" && id(c.arguments[1]) === "crmTenantId");
      let scoped = tenant;
      if (tool === "crm_get_contact_summary" && table === "tasks") scoped = chain.some(c => method(c) === "eq" && str(c.arguments[0]) === "biz_id" && id(c.arguments[1]) === "id");
      if (tool === "crm_get_contact_summary" && table === "deal_activities") scoped = chain.some(c => method(c) === "in" && str(c.arguments[0]) === "deal_id" && ["[]", "dealIds"].includes(text(c.arguments[1])));
      if (tool === "crm_get_contact_summary" && table === "communication_log") scoped = chain.some(c => method(c) === "eq" && str(c.arguments[0]) === "user_id" && text(c.arguments[1]) === '(contact.dataasany)?.linked_user_id||"00000000-0000-0000-0000-000000000000"');
      require(scoped && ["clients", "deals", "tasks", "deal_activities", "communication_log"].includes(table), `${tool}: ${table} preserves direct or verified-parent scope`);
      const select = chain.find(c => method(c) === "select");
      require(!!select && !text(select.arguments[0]).includes("*") && (ts.isStringLiteral(select.arguments[0]) || text(select.arguments[0]) === '`${CLIENT_RECORD_COLUMNS},client_contact_methods(kind,value,label,is_primary,position)`'), `${tool}: closed explicit columns`);
    }
    for (const call of calls) {
      const name = text(call.expression), r = root(call.expression), m = method(call);
      let safe = ["Math.min", "Math.max", "Math.round", "Number", "String", "Boolean", "Promise.all", "Date.now"].includes(name)
        || (pureMethods.has(m) && ["", "us", "String", "Date", "data", "deals", "unlinked"].includes(r))
        || helpers.has(name) || (tool === "crm_get_contact_summary" && name === "resolveClientReference");
      if (r === "admin") safe = readMethods.has(m) || (name === "admin.auth.admin.listUsers" && ["crm_search_contacts", "crm_list_deals", "crm_list_tasks"].includes(tool));
      if (r === "q") safe = readMethods.has(m) && m !== "from" && m !== "select";
      require(safe, `${tool}: unknown/effectful call ${name}`);
      if (name === "contactIdsByAddressToken") require(text(call.arguments[0]) === "admin" && text(call.arguments[1]) === "crmTenantId", `${tool}: address lookup tenant pin`);
      if (name === "resolveClientReference") require(text(call.arguments[0]) === "admin" && text(call.arguments[1]) === "crmTenantId", `${tool}: reference lookup tenant pin`);
    }
    require(visit(body, ts.isNewExpression).every(n => ["Date", "Error"].includes(id(n.expression)) || (tool === "crm_search_contacts" && id(n.expression) === "Map")), `${tool}: no effectful constructor`);
    const qs = visit(body, n => ts.isVariableDeclaration(n) && id(n.name) === "q");
    if (qs.length) require(qs.length === 1 && root(qs[0].initializer) === "admin"
      && visit(body, n => ts.isBinaryExpression(n) && id(n.left) === "q").every(n => root(n.right) === "q" || (ts.isConditionalExpression(n.right) && root(n.right.whenTrue) === "q" && root(n.right.whenFalse) === "q") || (ts.isCallExpression(n.right) && id(n.right.expression) === "applyContactSearchFilter" && id(n.right.arguments[0]) === "q")), `${tool}: query alias stays on scoped server client`);
    tools.set(tool, { key, seatAuthority: "workspace-admin", selfDescribe: true, executor: "edge.paige-ai-chat" });
  }
  for (const [tool, rpc, selfDescribe] of [
    ["pipeline_catalogue", "get_pipeline_catalogue", true],
    ["pipeline_archive_preview", "prepare_pipeline_archive_as_paige", false],
    ["pipeline_folder_archive_preview", "prepare_pipeline_folder_archive_as_paige", false],
  ]) {
    const branches = visit(chat, n => ts.isIfStatement(n) && text(n.expression) === `tc.function.name==="${tool}"`);
    require(branches.length === 1, `${tool}: exact incumbent dispatch`);
    if (branches.length !== 1) continue;
    const body = branches[0].thenStatement;
    require(!visit(body, n => (ts.isVariableDeclaration(n) || ts.isParameter(n)) && ["admin", "supabaseClient", "user", "personaCtx", "readPipelineWorkspace"].includes(id(n.name))).length, `${tool}: trusted bindings unshadowed`);
    const tenants = visit(body, n => ts.isVariableDeclaration(n) && id(n.name) === "tenantId");
    require(tenants.length === 1 && text(tenants[0].initializer) === "personaCtx?.tenant_id", `${tool}: server workspace`);
    const client = tool === "pipeline_catalogue" ? "supabaseClient" : "admin";
    const rpcCalls = visit(body, n => ts.isCallExpression(n) && text(n.expression) === `${client}.rpc` && str(n.arguments[0]) === rpc);
    require(rpcCalls.length === 1 && ts.isObjectLiteralExpression(rpcCalls[0].arguments[1]), `${tool}: actual canonical RPC`);
    if (rpcCalls.length !== 1) continue;
    const params = rpcCalls[0].arguments[1].properties;
    require(params.some(p => ts.isPropertyAssignment(p) && id(p.name) === "_tenant_id" && id(p.initializer) === "tenantId"), `${tool}: RPC tenant pin`);
    if (!selfDescribe) require(params.some(p => ts.isPropertyAssignment(p) && id(p.name) === "_requested_by" && text(p.initializer) === "user.id"), `${tool}: authenticated actor pin`);
    for (const call of visit(body, ts.isCallExpression)) {
      const name = text(call.expression);
      const rpcCall = name === `${client}.rpc` && (str(call.arguments[0]) === rpc || (tool === "pipeline_catalogue" && id(call.arguments[0]) === "name" && id(call.arguments[1]) === "parameters"));
      require(rpcCall || (tool === "pipeline_catalogue" && ["readPipelineWorkspace", "args.search.trim"].includes(name)), `${tool}: only incumbent read/preparation calls`);
      if (name === "readPipelineWorkspace") require(text(call.arguments[0]) === "(name,parameters)=>supabaseClient.rpc(name,parameters)" && id(call.arguments[1]) === "tenantId", `${tool}: detail uses caller-JWT adapter and server tenant`);
    }
    tools.set(tool, { key: `sales.${tool}`, seatAuthority: "workspace-admin", selfDescribe, executor: `public.${rpc}` });
  }
  return { findings, tools };
}
export function validateCrmReadBindings(chatText, dependencySources = dependencies()) {
  try { return inspectCrmReadBindings(chatText, dependencySources); }
  catch { return { findings: ["CRM read binding: source shape unavailable"], tools: new Map() }; }
}
/** Closed source-contract proof of existing preparation authority. Static SQL
 * inspection only; no SQL execution, provider action or new approval system. */
export function validatePipelinePreparationSql(sqlText) {
  const sql = sqlText.replace(/--[^\r\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const findings = [], require = (ok, label) => { if (!ok) findings.push(`Pipeline preparation SQL: ${label}`); };
  for (const [name, kind, columns] of [
    ["prepare_pipeline_archive_as_paige", "pipeline", "tenant_id,pipeline_id,short_ref,expected_version,expected_deal_count,requested_by"],
    ["prepare_pipeline_folder_archive_as_paige", "pipeline_folder", "tenant_id,folder_id,folder_name,expected_version,expected_pipeline_count,requested_by"],
  ]) {
    const definitions = [...sql.matchAll(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\([^]*?as\\s+\\$\\$([^]*?)\\$\\$;`, "gi"))];
    const body = definitions.at(-1)?.[1]?.replace(/\s/g, "").toLowerCase() ?? "";
    require(!!body && body.includes("ifauth.role()<>'service_role'thenraiseexception") && body.includes("usingerrcode='42501'"), `${name}: service-role refusal`);
    require(body.includes("performset_config('request.jwt.claim.sub',_requested_by::text,true);"), `${name}: requested actor drives authority`);
    require(body.includes(`insertintopublic.${kind}_archive_confirmations(${columns})`), `${name}: scoped confirmation row`);
    const table = sql.match(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${kind}_archive_confirmations\\s*\\(([^]*?);`, "i"))?.[1]?.replace(/\s/g, "").toLowerCase() ?? "";
    require(table.includes("expires_attimestamptznotnulldefaultnow()+interval'15minutes'"), `${name}: its token contract expires after 15 minutes`);
    if (kind === "pipeline") {
      require(body.includes("ifnotpublic.is_tenant_admin(_tenant_id)thenraiseexception") && body.includes("wherep.tenant_id=_tenant_idandp.short_ref=upper(btrim(_pipeline_ref))"), `${name}: tenant admin and exact pipeline scope`);
    } else {
      require(body.includes("ifnot(public.is_platform_owner()orexists(select1frompublic.tenantstwhere t.id=_tenant_idandt.owner_user_id=_requested_by))thenraiseexception".replace(/\s/g, ""))
        && body.includes("whereid=_folder_idandtenant_id=_tenant_idandlifecycle_status='active'"), `${name}: owner and exact active folder scope`);
    }
    const grants = [...sql.matchAll(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]*?\\)\\s+to\\s+([^;]+);`, "gi"))];
    require(grants.length > 0 && grants.every(m => m[1].trim().toLowerCase() === "service_role"), `${name}: service-only execute`);
    require(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\([^;]*?\\)\\s+from\\s+public,\\s*anon,\\s*authenticated;`, "i").test(sql), `${name}: browser execute revoked`);
    require(!/(?:update|deletefrom)public\.(?:pipelines|pipeline_folders|deals)|insertintopublic\.(?:paige_durable_work|paige_workflow_runs|paige_approval_requests)/.test(body), `${name}: no domain mutation/approval/dispatch`);
  }
  return findings;
}
