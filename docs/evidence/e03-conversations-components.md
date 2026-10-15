# E03 actual Conversations component evidence

**PARTIAL author evidence.** These frames mount the real `ClientsConversations` tree with explicit isolated Supabase/Auth/voice adapters. The PAIGE width fixture is not the actual panel; the full Solo navigation/header and authenticated customer contexts are not mounted. No provider/model send or real customer data. The owner's private screenshot is excluded.

Geometry source: `430dff611c4b47a5579fb45d8c7c555bb6792c56`. Cancellation source: `f2a6676ead640610b7399983848da9367d054668`. The latter adds receipt/epoch handling without redesigning the layout. See [manifest](ui-delivery/e03-conversations-components/manifest.json) for actual image dimensions, hashes and source identities, and [observed geometry](ui-delivery/e03-conversations-components/e03-actual-rendered-verification.json) for viewport/scroll/control measurements. Raster bytes are native JPEG, preserved without padding or resizing. The two1536 CSS viewport captures have1535px raster width and are explicitly qualified; exact full-shell viewport proof remains owed.

| CSS viewport | Panel space closed | Panel space open |
|---|---|---|
|1536×770|[Frame](ui-delivery/e03-conversations-components/e03-actual-1536-closed.jpg)|[Frame](ui-delivery/e03-conversations-components/e03-actual-1536-open.jpg)|
|1366×768|[Frame](ui-delivery/e03-conversations-components/e03-actual-1366-closed.jpg)|[Frame](ui-delivery/e03-conversations-components/e03-actual-1366-open.jpg)|
|1024×768|[Frame](ui-delivery/e03-conversations-components/e03-actual-1024-closed.jpg)|[Frame](ui-delivery/e03-conversations-components/e03-actual-1024-open.jpg)|
|900×1000|[Frame](ui-delivery/e03-conversations-components/e03-actual-900-closed.jpg)|[Frame](ui-delivery/e03-conversations-components/e03-actual-900-open.jpg)|

The existing composer and tools stay reachable. The [narrow exact-review card](ui-delivery/e03-conversations-components/e03-actual-900-review.jpg) fits without horizontal overflow. Observed keyboard path: review group (never automatic Approve) → Tab Approve → Tab Not now → Enter returns to Review reply and retains the draft. The fixture body has5px vertical scroll at900; authenticated shell scroll ownership, full traversal, native zoom/reflow, reduced-motion and assistive-tech checks remain unverified.

Cancellation browser controls: [unconfirmed](ui-delivery/e03-conversations-components/e03-actual-cancellation-unconfirmed.jpg), [confirmed](ui-delivery/e03-conversations-components/e03-actual-cancellation-confirmed.jpg), [observations](ui-delivery/e03-conversations-components/e03-cancellation-browser-verification.json). An empty receipt keeps Queued and says cancellation is unconfirmed; an exact true/no-error receipt returns the same message to draft. The three caller paths and scope changes are also exercised in the actual mounted component tests. This does not fix or close the server private-mail cancellation finding.

Reproduction: run the existing fixture entry with `node node_modules/vite/bin/vite.js --config scripts/live-drive/harness/e03-mount/vite.config.ts`; use the neutral `/solo/123456/clients/conversations` route and the explicit `case=unknown`, `case=cancel-unknown` or `case=cancel-confirmed` query. All backend edges are simulated/refused; the entry is outside the production build graph. Full authenticated nine-step journey, People navigation/persisted return, role/tenant isolation and provider receipts remain separate acceptance gates.
