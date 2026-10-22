# PAIGE Browser, Device, Resolution & Accessibility Support Standard

**Owner directive:** 2026-10-15. **Scope:** The one shared SOLO product, PAIGE typed Chat and Live, business-owner departments, the external Customer Portal, and any affected public authentication/onboarding flow. This extends [Paige UI Delivery Standard](paige-ui-delivery-standard.md), [AGENTS.md](../../AGENTS.md), and the existing UI evidence contract. It does not create another design system, identity layer, runtime, or tenant-specific branch.

## 1. Customer support promise

PAIGE must provide the **same authorized business capabilities and canonical records** to an eligible user regardless of supported browser, OS, display resolution, or display scaling. A browser-specific permission or hardware limitation (for example, microphone denial) may change **how** an interaction proceeds, but may not silently change the user's business role, entitlement, tenant, approval, Spine admission, receipt semantics, or data isolation. Explain unavailable device features truthfully and provide an appropriate typed or standard-UI fallback when possible.

We support modern browser versions, not every legacy browser. Explicit support target is the **current and immediately previous stable major version**, where compatible with a vendor-supported operating system. Refresh the actual version inventory each release cycle rather than hardcoding obsolete release numbers.

| Support surface | Required standard | Evidence distinctions |
| --- | --- | --- |
| Windows desktop | Google Chrome, Microsoft Edge, Mozilla Firefox | Chromium and Firefox engine automation; branded Chrome and Edge real-browser checks for login, file controls, and voice |
| macOS desktop | Safari, Chrome, Firefox; Edge when used by customers | WebKit automation **plus actual Safari** for permissions, auth/storage, media and visual behavior |
| iPhone/iPad | Safari on supported iOS/iPadOS | WebKit mobile simulation **plus actual Apple device/Safari** for keyboard, safe areas, touch, microphone and interrupted sessions |
| Android | Chrome on a supported Android release | Mobile Chromium simulation **plus actual Android Chrome** for keyboard, attachments, microphone and lifecycle |
| Other/embedded browsers | Best-effort, explicit limitation | Never silently advertise certified compatibility without a proven matrix |

Playwright's **Chromium, Firefox and WebKit** cover engine regressions and emulate mobile viewports. Its WebKit build is *not* the branded Safari browser; its automated mobile devices are *not* real iPhones or Android phones. Testing three engines does **not** prove all versions, actual mobile OS audio, system permission prompts, or true 4K hardware. Source: https://playwright.dev/docs/browsers .

## 2. Shared browser engineering contract

- Build on standards-track, broadly interoperable APIs. Prefer features designated **Baseline Widely available**; for newly available or limited features, check support and implement a safe fallback or bounded "not supported on this browser" explanation. Source: https://web.dev/baseline .
- Use **feature detection**, not a customer/account-specific user-agent switch, for optional device APIs. Do not gate legitimate CRM, Finance, Chat approval, tenant policy, entitlement, or business data on browser identity.
- Handle denied or unavailable microphone/camera/device permissions, no input device, speech capture interruptions, autoplay restrictions, media format issues, tab sleep, offline/online transitions, blocked third-party cookies, revoked sessions and stale application versions without false success or losing approved work.
- Preserve one canonical UI/Chat/Live/domain adapter; cross-browser changes affect presentation and device capability handling, not execution authority or action semantics.
- Keep native browser keyboard navigation, visible focus, ARIA semantics, contrast, reduced-motion preferences, accessible controls, touch targets, scroll ownership, safe-area insets, and iOS software-keyboard/composer clearance.
- Use the existing responsive Obsidian/Mineral tokens and Impeccable/Paige UI Design skills. No separate high-resolution layout fork or screenshot-specific customer UI.
- Do not read or expose private user mail, contacts, microphone recordings, user tokens or production customer content to screenshots, build logs, third-party device labs or QA fixtures.

## 3. Display, high density, scaling and zoom

**Viewport sizes below are CSS pixels unless explicitly marked physical-pixel targets.** Distinguish physical monitor resolution, OS display scaling, `window.innerWidth/innerHeight`, device-pixel-ratio, browser zoom, and browser chrome. Do not claim a physical 4K test solely because a screenshot is 3840x2160.

| Coverage tier | Required representative geometry | Purpose |
| --- | --- | --- |
| Small phone | 320x568, 390x844 | 320 CSS px reflow, input readability, Chat Send/voice, safe areas, recoverable navigation |
| Large phone | 428x926 | Touch and composer with virtual keyboard |
| Tablet | 768x1024, 1024x768 | Navigation, drawers, charts, split panes and touch |
| Laptop/desktop | 1280x800, 1366x768, 1536x770, **900x1000** | Existing four SOLO release sizes remain: 900x1000, 1024x768, 1366x768 and 1536x770 with PAIGE open/closed |
| Full HD | 1920x1080 | Legible workspace density and panel placement |
| QHD | 2560x1440 | Balanced max-width, usable information density and non-stretched forms |
| 4K native-width | 3840x2160 CSS-pixel viewport in synthetic layout test | Ultra-wide layout stability and large-screen utilization; not a certified physical display test |
| 4K scaled | Approx. 1920x1080 CSS viewport at 200% OS scaling on a 3840x2160 physical display, verified on actual hardware where available | High-DPI image and text sharpness, device-pixel ratio, balanced readable sizing |

**Scaling and accessibility:** exercise representative OS display scales **100%, 125%, 150%, 200%** (actual-device sampling, not all combinations in every PR), browser zoom at **100%, 200% and 400%** (reflow equivalence), and increased text preferences. WCAG 2.2 AA is the design target for new and materially affected interfaces; 1.4.10 Reflow calls for functioning content at **320 CSS px wide** without two-dimensional scrolling except legitimate two-dimensional content (e.g. complex data tables). Source: https://www.w3.org/WAI/WCAG21/Understanding/reflow .

Check high-density vector/icon/chart clarity, logo sharpness, responsive images (`srcset`/`sizes` where appropriate), image pixel cost, typography, panel width, non-stretched form fields, min/max width composition, two themes, PAIGE open/closed, error/loading/empty/success/consent/recovery states, and no unreachable interactive controls. 4K does **not** justify tiny text, raw 4K assets for small cards, a 3000-pixel-wide reading column, or gratuitous background effects.

## 4. Evidence required for visible changes

Each agent owns the evidence for their **affected customer flow** and must not state compatibility is PASS just because Vite built or Chromium tests passed. Preserve the existing eight mandatory SOLO geometry records and UI evidence fields. Add a clearly labeled **Browser/Device/Resolution Compatibility** subsection to that same UI evidence file with:

1. Exact tested engine, actual branded browser/device where applicable, OS/version, URL/route, customer/role/tenant class (anonymized), and browser permission state;
2. Tested CSS viewport, physical display resolution if real, device scale factor, OS display scale, browser zoom, theme, PAIGE open/closed, and scroll owner;
3. Actual outcome for real user actions: login, session/reload, navigation, Chat composer, approvals/refusals, Live microphone states, downloads/uploads, external OAuth return and Portal customer flow as applicable;
4. Focus order, keyboard/virtual keyboard, clipping/overflow, large-screen density, SVG/raster/graph sharpness, reduced motion and 320px reflow;
5. Artifact path and test command/commit for automated engine proofs, and separately identified actual-device evidence;
6. Explicit `PASS`, `FAIL`, `BLOCKED`, `UNVERIFIED` for each applicable slice and truthful statement of what was **not** tested.

Use **representative coverage based on changed risk**: UI geometry/source and engine tests for every materially affected visible flow, more exhaustive device/zoom combinations for changed Chat/Live, OAuth, Portal, onboarding, payments, document uploads and shared shell. No requirement to execute a Cartesian product of all screen, theme, browser and account combinations on every trivial document update.

**A real customer business action remains separately subject to** the one shared Harness/Spine/Trust/Rail authorization and the normal signed-in tenant acceptance proof. A responsive screenshot or synthetic browser is not business acceptance.

## 5. Release gate and rollout

**Now:** This is the binding **authoring and review policy** for newly changed customer-visible code. Agents record cross-browser and high-density coverage in the incumbent `RENDERED_EVIDENCE`, `BEHAVIORAL_EVIDENCE`, `ZOOM_REFLOW`, `AUTOMATED_EVIDENCE`, `UNVERIFIED` and human-readable evidence subsection; missing material proof is a review finding, not a silent success. Do not falsely claim a CI-enforced all-browser matrix exists yet.

**Engineering adoption (own bounded CI follow-on):** extend the existing `scripts/ci/ui-delivery-evidence.mjs` and canonical template after confirming compatibility with current open PR evidence. Add a scoped, deterministic Playwright test suite using Chromium + Firefox + WebKit for shell, Chat composer/open-close, login return, Portal entry and high-risk flow states. Run changed-surface smoke on PRs and broader signed-in/device matrix on scheduled release acceptance. Add genuine browser/device QA for real Safari/iOS and Android/Chrome, Windows Edge and voice/media. Any new required CI status/context needs explicit ruleset inspection and a staged cutover; never surprise-break active Experience releases.

**Ship truth:** Release only when applicable required CI/review passes and material changed-surface compatibility problems are fixed or a real owner-approved documented support limitation is declared. State `UNVERIFIED` rather than advertising Safari/iPhone, 4K physical hardware, restricted audio or all-account equivalence without the corresponding evidence. Final owner UX evaluation remains after ordinary technical release per AGENTS.md, and is distinct from the authentic acceptance phase.

**Priorities and ownership:** This standard applies platform-wide immediately. Shared QA/visual infrastructure adopts the reusable engine and real-device evidence machinery; **each Experience agent remains accountable for its own changed UI/Live/Portal acceptance** without rewriting other agents' protected source. Preserve active P0 BUG restoration, E01 and E09 work and the universal SOLO rule.
