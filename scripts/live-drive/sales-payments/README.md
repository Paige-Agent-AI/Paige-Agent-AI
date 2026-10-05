# Internal Sales payment rendered fixture

Run `npx vite --config scripts/live-drive/sales-payments/mount/vite.config.ts`.
This renders actual invoice/payment/review/public components with synthetic RPC/auth/provider projections. No provider is contacted and no authenticated acceptance is established. Port5268. Owner cases: `?state=prepared`, `?state=provider_accepted`, `?state=outcome_unknown`, `?state=settled`. Public cases: `?surface=customer&state=customer_action_required&token=` followed by64literal `a` characters. Captured synthetic invoice HTML is not production PDF evidence. Never use this fixture as live acceptance.
