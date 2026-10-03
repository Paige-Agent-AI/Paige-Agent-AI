# Sales release prerequisite: CSS build dependency classification

The production dependency audit failed on GHSA-vfj7-8cjw-p6xm through braces -> Tailwind. No patched braces version was offered by the advisory on 2026-10-02. Tailwind is already development tooling; tailwindcss-animate was incorrectly a production dependency, pulling its Tailwind peer into the production audit tree.

Source search found the plugin only in tailwind.config.ts, never src or edge runtime. Move it to devDependencies without changing its version, configure no audit exception, and retain build-tool risk honestly. Both lockfiles regenerated.

Verification: npm production audit high+ exits 0, zero high/critical and two existing moderate findings. NPM package version/resolution comparison to previous commit: zero changes. Bun before/after yarn projections byte-identical; Bun 1.4.2 frozen lockfile-only validation exits 0. Binary Bun metadata differs; package set/version projection does not. No advisory is waived and no package upgrade is claimed. Full build/CI proof is recorded in PR before merge. Development-tool vulnerability remains; this change correctly classifies reachability rather than claiming a patched package.

An initial older Bun invocation could not parse the repository lockfile; stopped before any lockfile write, then used npm-reported current Bun 1.4.2. Only the bounded classification change and regenerated metadata are committed; scratch projections stay local.
