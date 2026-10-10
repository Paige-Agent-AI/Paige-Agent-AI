# INT-280 AI-1 independent review evidence

Reviewers were the existing non-author engineering and design review agents. They made no implementation edits and no additional agents were created. These are agent review dispositions, not fabricated GitHub approvals.

| Slice | Exact reviewed head | Disposition |
|---|---|---|
| AI-1A #1903 | 11c98f9e67802f795b0a308df2608fc9328b0199 | COMPLETE/PASS; stale-attempt verification and unrecognized negative receipt findings fixed and rechecked |
| AI-1B #1906 | 7f30ea4321cf39d38c407b2b12e573eb6627df98 | COMPLETE/PASS; canonical history, replay, immutability, privacy, truncation and main integration; independent local PostgreSQL proof passed |
| AI-1C #1911 | 0f6f8af768353873c7339ca6086c911cdbc51b45 | COMPLETE/PASS; approval references require exact producer and act execution; retired working-context traces excluded; independent canonical/security PostgreSQL proof passed |
| Fleet cleanup #1912 | d492dad65fa34705d1c90ebf007a7c81f15e832f | Engineering and design COMPLETE/PASS; stale shared subtab expectation fixed; 38 regression tests pass; new UI evidence record satisfies guard |
| AI-1D #1914 | 43bfb2e5b12ddde09ae13266064450a41feaa98e | Engineering and design COMPLETE/PASS; historical dispatch no longer labelled as current attempt execution; independent 35-test focused suite passed |

D rendered findings were fixed: narrow main overflow caused by an uncontained absolute screen-reader heading; positioned, locally scrolling table wrappers resolve it. Timeline separators are 1px. Both themes, mobile wrapping, keyboard inspection close/focus return and five viewport geometries were reviewed. The current-attempt wording correction was source-reviewed; no fresh screenshot is claimed for that wording alone.

Final main compatibility review against e70cf505136cbdeb6772495e5d9f4312a785bec5: C merge tree623918cf304a2457aa5748c50cada6a7a6240e14 and D merge tree1a536001aa34dbbe8a999f3c80cf789c9223f9d8 independently passed. Fleet removal, B history and reviewed source were preserved.

Supabase preview advisor dispositions were independently reviewed:

- INFO private paige_durable_work RLS without policies: intentional FORCE RLS and revoked raw DML for PUBLIC/anon/authenticated/service_role; adding policies would expand access. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- WARN authenticated SECURITY DEFINER trajectory RPC: intentional Operator entry point with authenticated identity, canonical Platform Admin predicate, fixed empty search path, bounded minimal metadata and fail-closed auditing. Wrong-role/scope/audit-refusal tests passed. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Neither advisor entry warranted a privilege change. Unrelated baseline advisor findings were outside this lane; this is not a blanket clean-database claim.

Authenticated production Operator acceptance, browser zoom, full assistive-technology and OS reduced-motion acceptance remain UNVERIFIED. Source, controlled PostgreSQL, rendered harness, hosted CI and production readback evidence are separate proof classes.
Final candidate c433c327c4a89a57e2c1373bcc843e59712f409b versus released main 0bf8a331ea9b322d4b70d0006504d77b7022de94: independent engineering and design COMPLETE/PASS. No actionable findings. Production inspector, hook, styles, contracts and tests are byte-identical to cleared43bfb2e5; main integration preserves Fleet removal and released B/C migrations. Independent execution of the isolated review adapter confirmed exact work/model matching, unrelated-reference refusal, canonical snapshot preservation on refresh and empty close/unlinked states. Latest captures retain LOCAL SYNTHETIC. Previous independent35/35 production-source tests remain applicable; new combined87/87 regression is author-executed evidence. Fresh exact-head hosted CI is recorded separately; no cancelled/superseded run counts as PASS.

