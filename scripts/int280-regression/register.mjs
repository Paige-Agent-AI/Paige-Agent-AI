/** Test-only extension of the existing credit handler loader; no live executor. */
import '../sync-credit-report-data/register.mjs';
import { register } from 'node:module';
register('./source-hook.mjs', import.meta.url);
