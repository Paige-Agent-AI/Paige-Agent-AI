# How Paige UI work gets designed, tested, and released

Every interface assignment follows the same simple path.

1. **Understand the whole job.** The agent starts with Flow-by-Flow, identifies who is using the interface, what they need to accomplish, and what neighboring flows could be affected.
2. **Apply Paige's UI rules.** Before drawing or coding, the agent reads the pinned Paige UI Design skill. It uses Paige's established design language, real data and permissions, honest states, complete exits, and accessible interaction.
3. **Explore new flows.** If the work changes steps, choices, confirmations, recovery, or consequences, consult Flow Prototype and record actual evidence. Unrun prototype/browser checks remain `UNVERIFIED` while safe implementation and release proceed.
4. **Build the complete experience.** Loading, empty, failure, retry, permission, success, cancellation, Back, and workspace-switch behavior are included where relevant. A working-looking mock is not treated as working software.
5. **Prove what is true.** Tests, code checks, rendered screenshots, behavioral browser drives, and authenticated tenant proof are reported separately. Anything not actually exercised is labeled `UNVERIFIED`; unsupported capability is `UNAVAILABLE`.
6. **Review, release, then verify live.** The pull request includes a structured evidence record. Complete proportionate engineering tests and technical review, pass genuine required CI, then merge/deploy safely and perform live browser/customer checks. Missing prototype/browser evidence alone does not prevent safe release; it remains `UNVERIFIED`, and outcome acceptance stays open. Security, tenant boundaries, action authority, functional checks and migration order remain mandatory. The canonical Release Governance & Customer Update Policy separates the exact internal build identity, release channel, and any earned customer release identity; it controls What's New wording and customer announcement. <!-- RELEASE_GOVERNANCE_POLICY -->

For Solo work, proof covers four required screen sizes with PAIGE closed and open, plus the affected tenant and another known-good tenant. Reviewers check real scrolling, clipping, reachability, keyboard/focus, zoom, reduced motion, and relevant states.

The automation is intentionally lightweight: it can prove that a required evidence record is present and structurally complete, but it cannot prove an agent was truthful. Human review and reproducible artifacts remain part of release.
