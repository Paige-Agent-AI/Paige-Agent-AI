# Isolated client artifact proof

Run from a repository checkout with its normal Node dependencies installed. The component uses explicitly synthetic local RPC/session ports; it is not a production client route and performs no customer or provider action.

1. `node assets/operations-v3/client-artifact/server.mjs 8796` starts loopback only. An optional second argument is an absolute repository/app path. Dependencies and source resolve from that app, not a sibling worktree.
2. `node assets/operations-v3/client-artifact/verify.cjs` runs the32 component cases using Playwright's installed Chromium. `OPERATIONS_BROWSER_EXECUTABLE` optionally names an installed compatible browser.
3. `node assets/operations-v3/client-artifact/verify-zoom.cjs` runs eight genuine200/400percent cases using installed Chrome. It creates isolated synthetic profiles under the repository `.tmp/operations-client-zoom`, never a personal Chrome profile.

Set `OPERATIONS_PREVIEW_URL` to another loopback preview address when the port is occupied. Captures and JSON reports are written beside the verifier. Native zoom needs Chrome installed; it must fail rather than report device emulation as native zoom. End the owned server after validation. Customer authentication, portal/shared-shell continuity and actual client acceptance remain unverified.
