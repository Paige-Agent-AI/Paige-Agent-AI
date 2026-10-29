# Internal Sales payment rendered fixture

Run `npx vite --config scripts/live-drive/sales-payments/mount/vite.config.ts`.
This renders actual invoice/payment/review/public components with synthetic RPC/auth/provider projections. No provider is contacted and no authenticated acceptance is established. Port5268. Owner cases: `?state=prepared`, `?state=provider_accepted`, `?state=outcome_unknown`, `?state=settled`. Public cases: `?surface=customer&state=customer_action_required&token=` followed by64literal `a` characters. Captured synthetic invoice HTML is not production PDF evidence. Never use this fixture as live acceptance.

Accepted-operation recovery cases: `?state=review_unknown&target=deposit`,
`?state=review_unknown&target=installment`, and `?state=review_unknown&target=invalid`.
The existing **Check existing request → Recover original operation → Close review**
flow must retain the same operation and accepted selector, keep an unknown result,
and restore the original trigger after the list reloads. Expand **Synthetic request
evidence** to inspect the actual SDK-port input. Invalid target evidence must show
the existing read failure/retry without a new payment action. `connect-src 'none'`
and fixture-only ports prevent provider/backend effects; expected blocked HMR is
not a product connection failure. This mount is not the full SOLO shell.
