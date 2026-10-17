# Invitation extension: design preservation

Ordinary Operate extension; no visual-system change. Compared the finished invitation command, manager and owner dashboard against `DESIGN.md`, `.impeccable/design.json`, `PRODUCT.md`, the invitation surface brief and delivery packet, following `reference/document.md`. Incumbent system files are preserved without edits. Their sampled Chat/Calendar/Operations/weekly scope is not expanded into universal Portal authority.

## Source and rendered evidence

The command uses existing `opd-button`/`opd-primary` controls and the shared `PaigeConfirmCard`. It introduces no stylesheet, font, color token, shell, icon language or confirmation design. The manager retains the existing invitation section and pending cancellation control. The owner dashboard removes the redundant recipient field; the shared server-summary card discloses the recipient. The Auth recovery uses an existing control class and a concrete sign-in link.

Sampled `src/index.css`, `owner-portal-dashboard.css` and `PaigeConfirmCard.tsx`: Obsidian/Mineral roles, Schibsted UI, warm tonal surfaces, quiet rules, compact controls, native dialog scroll ownership and reduced-motion card behavior remain incumbent implementations. Portal's local 18px heading, 38px control minimum and gold focus are existing scoped choices; they are not promoted to shared tokens.

Viewed `.impeccable/review/invitation/desktop.png` and `mobile.png`, plus `1536-770-closed-dark-invite-ready-session.png` and `390-844-closed-light-invite-ready-session.png` in this directory. The desktop/mobile review and session states retain the same shell, dialog, reading hierarchy, wrapping history and visible controls. No visible regression from the Auth recovery is apparent in these four captures. This is a bounded documentation comparison, not a replacement finish review.

`result.json` contains 23 cases and zero errors. All 19 recorded source SHA256 values match current files, including the command, manager, dashboard, shared card, Portal stylesheet, theme source and harness bindings. SDK/Auth/records are synthetic and network is blocked. Actual authority, provider delivery, customer acceptance and physical-device acceptance remain UNVERIFIED. The detector was not rerun.

## Hashes checked

| File | SHA256 |
| --- | --- |
| `DESIGN.md` | `fb5b1d84e1c5e092db2f89d2f46059ed894c01355f4dc5594366ae0b1f46c500` |
| `.impeccable/design.json` | `10749d235989f091c898f6099b359a48a1f2aa5388c5f12a8d3729923a46d2b0` |
| `PortalInvitationCommand.tsx` | `91ac805d0233849f369adfd98b2575118062f190b8fee3d885846b7d0889f7c0` |
| `PortalInvitationManager.tsx` | `36de8defda42d94a61e39e8014cf14b233083856aecec28cff0218ec505f81e5` |
| `OwnerPortalDashboard.tsx` | `5ecc9b2986709f723a1abb40a3ae6b4331027863def34203205a8816edd5d9e1` |
| `result.json` | `6b7b4a2809878d6e84978d9a1567e75d21962ba5cc49ea4d2f25c5f2ca513d85` |
| `.impeccable/review/invitation/desktop.png` | `2fa9b39654bf4fb0b7d524d91acadcc008fb191695b67433d94ab6dae2321fa0` |
| `.impeccable/review/invitation/mobile.png` | `67f3c28eee8b06ead57d14257fadaca0e4f16cb9a2c7b343990344dc961e229d` |
| `1536-770-closed-dark-invite-ready-session.png` | `437ff5f911038a0983678e0c47acd698acd1d570bc30655d7800b122327d709f` |
| `390-844-closed-light-invite-ready-session.png` | `5bc4b3884b9281b974d1d77c0cd3e8f04db9e553edcff16475db4933870510b7` |

## System summary

- Palette: separately authored Obsidian and Mineral through existing theme roles.
- Type: Schibsted UI; shared 11/13/16/21px roles, 14px reading body, component-local sizes stay local.
- Theme Root Rule: preserve authored `--pg-*` roles.
- Prose Figures Rule: tabular numerals belong on figures.
- Existing Depth Rule: use incumbent tonal layers and elevation.

Not canonized or repaired: existing Portal gold focus/local control sizing and incumbent Calendar/small-text exclusions stay scoped; `DESIGN.md`'s root-wide tabular-numeral defect sentence is stale relative to current `src/index.css`, which explicitly omits root tabular numerals. These pre-existing documentation/source differences are outside this ordinary extension; no system refresh or runtime repair is performed.
