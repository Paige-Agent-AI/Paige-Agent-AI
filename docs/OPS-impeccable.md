# Impeccable — install, enforcement, and what it actually checks

**What it is.** `impeccable` (npm, Apache-2.0, Paul Bakaus — [repo](https://github.com/pbakaus/impeccable) ·
[site](https://impeccable.style)), pinned at **4.1.0**. It ships design skills for the agent AND a
detector CLI for UI anti-patterns. §00 names it as the craft authority that runs after Flow-by-Flow.

## Install

```bash
npx impeccable@4.1.0 install --yes --project     # needs Node >= 22.18 (measured on v22.22.2)
```

Installs into `.claude/`, `.agents/`, `.github/` (and `.codex/`). The **skill content is committed** —
that is the part the agent reads every session. The **engine binary is not**: it is ~16 MB,
`linux-x64`-specific, and installed once per harness directory, so committing it would put ~48 MB of
platform-locked executable into every clone forever and be useless on macOS or Windows. `.gitignore`
excludes `*/skills/impeccable/scripts/bin/`; rerun the command above to restore it on any machine.

## Enforcement

CI runs the detector on the **files a PR actually touches**, next to the existing ESLint and
gold-discipline changed-src lints (`.github/workflows/ci.yml`, step *Impeccable — UI anti-patterns
(changed src)*). Locally:

```bash
npm run lint:impeccable                          # whole src/ — expect pre-existing findings
npx impeccable@4.1.0 detect <files...>           # what CI does, on your change
npx impeccable@4.1.0 detect --json <files...>    # structured; findings print to STDERR otherwise
```

**Why changed-files and not repo-wide.** `src/index.css` already carries findings (below). Failing
every unrelated PR on them trains people to ignore the gate. Touch a file, own its findings.

**Exit codes.** 0 clean · 2 findings · 1 could-not-scan. Findings go to **stderr**; stdout is left for
`--json`. MEASURED: `xargs` collapses any non-zero to 123, so the CI step fails on findings and on an
unscannable target without distinguishing them — the same trade the two lints beside it already make.

## Baseline at install (2026-09-24, measured — not fixed here)

`src/index.css`, 6 warnings. Left alone deliberately: a global stylesheet touches every surface, and a
tooling PR is the wrong place to restyle the platform.

| Antipattern | Count | Where | Note |
|---|---|---|---|
| `overused-font` | 1 | `:746` `font-family: "Inter` | the face AI UIs converge on |
| `gradient-text` | 2 | `:1333`, `:1535` | `background-clip: text` + gradient |
| `bounce-easing` | 3 | `:1452`, `:1453`, `:1465` | incl. `cubic-bezier(0.68, -0.55, 0.265, 1.55)` |

These line up with §22's standing anti-pattern doctrine and `docs/design-references/CHEESY-TELLS.md`,
which is the argument for the detector: it enforces mechanically what doctrine asks agents to remember.

**Both Live Conversation stylesheets scan clean** (`paige-live-conversation.css`,
`paige-presence.css`), verified at install.

## Honest limits

- Scopes are `type` and `layout`. It did **not** flag a deliberately awful fixture built from inline
  JSX styles (11px heading, `#eee` on `#fff`, Comic Sans, `div` with `onClick`, unlabelled input,
  18px target) — measured, `[]` and exit 0. It reads stylesheets, not inline style objects, so it
  **complements** the accessibility and contrast work in `paige-ui-design`; it does not replace it.
- Some findings are advisory and never change the exit code (`--no-advisory` hides them).
- A passing scan means no rule matched. It is not evidence the interface is good (§13).
