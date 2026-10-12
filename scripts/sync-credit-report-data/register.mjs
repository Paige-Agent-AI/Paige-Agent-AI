/**
 * Registers the loader. Imported for side effect BEFORE the module under test, e.g.
 * `node --import ./scripts/sync-credit-report-data/register.mjs <check>`.
 *
 * Mirrors scripts/apply-extraction/register.mjs (same Node >= 20.6/20.11 requirements and
 * the same esbuild-through-overrides pinning rationale — see that file's header).
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./stub-hook.mjs", pathToFileURL(import.meta.filename));
