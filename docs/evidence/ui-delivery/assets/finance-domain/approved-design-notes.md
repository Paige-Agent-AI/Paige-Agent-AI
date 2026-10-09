# Finance workspace — descriptive design notes

The finished local seven-tab prototype is `finance-workspace.html`; its authoritative editable source is `../work/finance-workspace-template.html`. The owner approved all three concepts and authorized live merge on green. Independent full-prototype critique records SHIP after source-label, account-1042, Banking, and Expenses fixes. This describes a synthetic prototype, not merged production implementation: production implementation remains unmerged, and no new approval pause is introduced by these notes.

## Inherited visual expression

The workspace retains PAIGE Solo's Obsidian and Mineral themes, champagne financial/action emphasis, violet intelligence/selection, embedded Schibsted Grotesk, and tabular financial figures. Its observed values and hierarchy continue the concept-round notes: Obsidian background `#100e14`, warm text `#f6f2ea`, champagne `#ead5aa`, violet `#9b8de0`; Mineral background `#fbf9f5`, text `#201e23`, financial emphasis `#8b7049`, violet `#655a96`. Signature and Higher contrast chart controls remain local. Body text is 13px; supporting labels 11px; shared page headings 30px; larger financial and editorial values retain concept-specific emphasis. Fine separators and tonal surfaces organize the content without adding a new brand identity.

## Seven human jobs

| Tab | Shipped local composition and interaction |
| --- | --- |
| Overview | Financial Review's monthly profit/cash narrative, income bridge, statement, PAIGE interpretation, and explicit financial decisions; decision links open the dossier. |
| Banking & Cash | One historical available-cash/reconciliation summary, selectable source-named account balances, historical cash movement, searchable/filterable selected transactions, and contextual reconciliation review. |
| Receivables | Open versus overdue balances, aging, customer filters, Sales invoice detail, distinct settlement evidence, and an internal Sales handoff. |
| Expenses & Payables | Operating-cost mix, software variance investigation, dated unpaid obligations, and a contextual bill-timing review. It does not reuse unrelated cash-shortfall advice as the main explanation. |
| Profitability | Expandable accrual statements and financial subtotals, period/report exploration, account investigation, and a route to source-account mapping. |
| Budgeting & Forecasting | Dated base-versus-plan comparison, hypothetical receipt-delay preview and explicit Compare, scenario reference lines, accessible numeric alternatives, and an immersive chart viewport. |
| Connections | Accounting, bank, and Sales coverage cards distinguish sample connection from live readiness; source-label/financial-meaning mapping remains inspectable. |

Source account names remain company-source labels, separate from analytical definitions. Observed labels include Operating · 1042, Tax & Opportunity Reserve, Software & subscriptions, and Direct service costs. Operating identity is consistently 1042; Reserve identity is 2088. A label review does not rename the books or change accounting meaning. Connections explicitly withholds unsupported totals when meaning is unresolved.

## Responsive composition

The inherited navigation compresses from 180px to 68px below 1100px, then 48px below 560px. Tab navigation scrolls within its own strip and brings the active tab into view; financial tables retain contained overflow. Main content scrolls vertically through the complete local workspace.

On phone, Overview retains headline-first financial orientation. Banking puts account balances and the reconciliation explanation before historical movement and transactions. Expenses puts its variance/obligation advice before detailed costs and bills. Connections stacks coverage and mapping with explicit source-quality context. These are workspace compositions, not canonical rules for other PAIGE surfaces.

Evidence and PAIGE use protected native dialog drawers, with Escape/focus behavior retained. Planning offers drag-to-pan, Zoom in/out, and Reset view; chart viewport changes do not change amounts. SVG text compensation targets 11 screen pixels and runs after rendering, drawer opening, chart zoom, and viewport resize. The cash floor is explained outside the plotted points. Native browser zoom and screen-reader acceptance remain UNVERIFIED.

## Synthetic truth and authority

Northstar Studio, its source records, people, and financial conclusions remain fictional deterministic fixtures. Persistent sample labels recur in drawers. September historical cash is $184,600; recognized revenue $112,000 less $86,000 costs yields $26,000 pretax profit. Accounts total the historical cash; selected bank transactions are a subset, not the full ledger. Open receivables are not collected cash; captured payment, allocation, and deposit stay separate. Sales retains invoices and collections.

Entry and Refresh example run an actual local 650ms loading transition; the loaded time is not provider synchronization. Receipt-delay edits preview one to four weeks without altering the active forecast until Compare. Comparison applies only to the hypothetical fixture. Evidence → PAIGE meaning → responsible internal draft → local simulated approval creates no real task, Rail receipt, customer message, payment, accounting write, or provider action. Source-state and role controls remain simulations, not authenticated permission proof.

## Evidence and delivery status

`finance-workspace-proof.json` records local workspace checks; `finance-workspace-scoped-fix-proof.json` records the final Banking/Expenses/Connections repairs across both themes at 1536 and 390px. The scoped file reports no horizontal overflow or page errors, consistent account identity, valid reconciliation/bill drafts, contextual Expenses advice, one Banking summary, and phone reconciliation before history. This documentation pass inspected the authoritative template, those saved proof files, and current Banking/Expenses/Connections phone screenshots; it did not rerun the browser suite.

Independent critic SHIP applies to the finished synthetic prototype after repairs. Owner authorization supports normal delivery and live merge when green; it does not mean production merge has happened. Provider activation, tenant-safe live reads, event refresh, actual tasks/Rail effects, native zoom, screen-reader acceptance, and authenticated production behavior remain UNVERIFIED until separately proved.

Not canonized or repaired here: surface-specific composition and unverified production behavior. This pass changes documentation only; canonical DESIGN.md, sidecar, design HTML, and product/repository sources remain untouched.
