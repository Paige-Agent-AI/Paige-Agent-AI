# Operator retirement — protected parent call access

Accountable operator: existing authorized PAIGE Twilio administrator with Supabase production secret-management authority. This is connection setup under existing owner authorization, not permission to remove an account.

Twilio's [suspension contract](https://www.twilio.com/docs/usage/fraud-response-guide/contain) invalidates suspended-child credentials, and [subaccount access](https://www.twilio.com/docs/iam/api/subaccounts) excludes Main API keys from child Calls. PAIGE needs parent Auth Token read authority to verify that calls have finished. Suspension alone does not terminate existing calls.

1. Privately verify that the existing protected `TWILIO_ACCOUNT_SID` is the intended platform parent account, retaining the platform phone number and all surviving tenant resources.
2. Through the existing approved Supabase production Edge Function secrets interface for PAIGE project `xygzykjyynhzqytbqnzu`, ensure `TWILIO_AUTH_TOKEN` contains that same parent's current Auth Token. Leave the configured Main API key and ordinary tenant Vault keys intact. Values must never enter chat, GitHub, screenshots, shell history, source or logs. No token is to be transferred to the agent environment.
3. Confirm setup with only the project, variable name and completion state. The token's presence is not authenticated acceptance.
4. In the owner's existing signed-in Platform Operator session, reopen the exact account preparation and **Read resource outcome** for its original operation first. This performs bound provider readback. If still active and explicitly approved, use the existing typed-name/consent continuation. Complete the fresh Archive review, then review the fresh Delete scope and its independent dependencies.
5. Read back each actual Archive/Delete receipt and Fleet absence. Preserve the platform parent, platform number, shared Auth identities and surviving accounts. Unknown outcomes must reconcile the original operation; real in-flight calls require their normal completion.

The agent cannot establish the current secret's presence using unauthenticated public probes or source readback. Agent production login remains prohibited. This packet does not authorize live agent provider mutations, account deletion, billing termination or INT-346 activation. Provider closure, PAIGE data retirement, required retention and authenticated owner acceptance remain separately evidenced outcomes.
