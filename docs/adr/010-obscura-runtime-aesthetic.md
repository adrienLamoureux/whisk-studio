# ADR 010 — Obscura: a Second, Runtime-Switchable Aesthetic

**Status**: Accepted
**Date**: 2026-07-07

---

## Context

Sakura Bloom is a deliberately anime-flavored design (pink neon glows, rounded shapes, playful
motion). We want the studio to also appeal to a less-anime audience with a darker, more painterly
presentation — inspired by Belle Époque / chiaroscuro art direction (ink blacks, antique gold,
serif typography) — without forking the product.

ADR 008 removed the old *build-time* design variants (separate stacks, branches, worktrees) and
explicitly left the door open:

> **Neutral:** `UiOnlyStack` and `--backend-stage` are gone. If a second design is ever wanted, it
> comes back as a fresh decision — not resurrected scaffolding.

This is that fresh decision. Obscura is **not** variant scaffolding: it is runtime theming inside
the single codebase and the single `StaticWebAWSAIStack-dev` deploy path, extending the same
attribute-driven CSS-custom-property mechanism the 10 Sakura palettes already use (ADR 003).

---

## Decision

Introduce a two-axis appearance model:

1. **Aesthetic axis** (`data-aesthetic` on `<html>`, localStorage `skr-aesthetic`):
   `sakura` (bright anime) | `obscura` (dark painterly). Owned by `ThemeContext`; enum-validated
   on read and write. **Obscura is the default** for visitors with no stored preference, and the
   default brightness fallback is now `dark` (stored preferences always win).
2. **Palette axis** (`data-theme`, the existing 10 themes) applies **only under Sakura**. While
   Obscura is active, `ThemeContext` removes `data-theme` entirely so no `[data-theme=X]` block can
   compete; the stored `skr-theme` survives for switch-back. `data-brightness` stays live in both
   aesthetics (Obscura dark = "canvas at night", Obscura light = "atelier at dawn").

Implementation shape:

- Obscura lives in `frontend/src/styles/obscura/` (tokens / components / motion / light), imported
  **last** in `index.css` so its `[data-aesthetic="obscura"]` blocks win the cascade. It overrides
  tokens (colors, fonts → Cormorant Garamond + Spectral, radii, motion durations/easings) plus a
  bounded set of component restyles (gilt frames, vignette+grain backdrop, serif optics).
- A pre-paint script in `public/index.html` applies stored attributes before React mounts (no
  default-aesthetic flash).
- Switching triggers a transient `skr-aesthetic-transition` class → `skr-chiaroscuro-sweep`
  paint-stroke wipe (reduced-motion disables it), mirroring the ModeContext ink-wash pattern.
- Toggles: sidebar footer (◐/❀), companion-stage meta strip, mobile HUD. The revived
  `ThemeSwitcher` palette picker renders only under Sakura.
- Agent integration: `/aesthetic` slash command + backend `set_aesthetic` tool. The `aesthetic`
  pref joins `AGENT#STATE` behind `validatePrefValue` (enum-guarded on read AND write — prefs
  re-enter the system prompt). `set_theme` now implies returning to the Sakura aesthetic.
- Groundwork that made this cheap (and is valuable standalone): all hardcoded pink/purple chrome
  literals were tokenized to `color-mix(var(--skr-*))`, companion inline styles now reference
  `--skr-comp-*` tokens, and shared `Modal`/`Button`/`Spinner` primitives replaced the three
  divergent modal implementations.

Known limitation: `<select>` dropdown arrows are SVG data-URIs — `var()` can't reach inside them,
so Obscura ships a gold twin of the pink chevron (documented in `frontend/THEMES.md`).

---

## Consequences

**Positive**
- One codebase, one stack, two full aesthetics switchable at runtime — no variant scaffolding.
- The tokenization groundwork means future aesthetics (or Obscura sub-palettes) are mostly a
  token-block away.
- The darker default broadens the audience beyond anime fans while keeping Sakura one click away.

**Negative / Trade-offs**
- `styles/obscura/` adds ~600 CSS lines to maintain, and every future component must be checked
  under 2 aesthetics × 2 brightnesses (visual QA is manual — no automated visual regression).
- New CSS custom properties must now be defined twice (Sakura value in `tokens.css`, Obscura value
  in `obscura-tokens.css`) — noted in `CONTRIBUTING.md`.
- Two extra Google Font families load unconditionally (`display=swap` mitigates).

**Neutral**
- Director's app-config default theme remains Sakura-axis-only in v1.
- No mobile brightness toggle existed before; the mobile HUD now has an aesthetic toggle, but
  brightness on mobile is still agent-command-only — parity gap inherited, not introduced.

---

## Rollback

Flip `DEFAULT_AESTHETIC` back to `"sakura"` (ThemeContext + the pre-paint script) to demote
Obscura to opt-in, or delete `styles/obscura/` + the aesthetic axis entirely — it is additive;
the tokenization and primitives groundwork stands on its own either way.
