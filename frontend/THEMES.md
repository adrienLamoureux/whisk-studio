# Whisk Studio — Theme System

> Last updated: 2026-07-07 (ADR-010: Obscura aesthetic)

The appearance system has **three independent axes**, persisted separately in `localStorage` and
applied as `data-*` attributes on `<html>`:

| Axis | Values | `localStorage` key | HTML attribute | Default |
|------|--------|--------------------|----------------|---------|
| **Aesthetic** | `sakura` \| `obscura` | `skr-aesthetic` | `data-aesthetic="<id>"` (always set) | `obscura` |
| **Color palette** (Sakura only) | 10 ids below | `skr-theme` | `data-theme="<id>"` | `sakura` (attribute omitted) |
| **Brightness** | `dark` \| `light` | `skr-brightness` | `data-brightness="light"` | `dark` (attribute omitted) |

**Aesthetic vs palette:** the aesthetic is the *design language* — typography, shapes, motion,
textures, and its own palette. The 10 color palettes only apply under the **Sakura Bloom**
aesthetic. While **Obscura** is active, `ThemeContext` removes `data-theme` entirely (the stored
value survives for switch-back) so no palette block can compete with the Obscura token set.
Brightness works in both aesthetics. Switching aesthetics plays the `skr-chiaroscuro-sweep`
transition (a transient `skr-aesthetic-transition` class on `<html>`; disabled under
`prefers-reduced-motion`).

A pre-paint script in `public/index.html` applies all three attributes from `localStorage` before
React mounts, so there is no flash of the default look. Its fallbacks must match the defaults in
`ThemeContext.js`.

### Key files

| File | Role |
|------|------|
| `src/contexts/ThemeContext.js` | State, persistence, attribute injection, enum guards — exports `useTheme()` |
| `src/components/sakura/AestheticToggle.js` | ◐/❀ aesthetic switch (sidebar footer, HUD, companion stage) |
| `src/components/sakura/ThemeSwitcher.js` | Sakura palette dropdown (sidebar; rendered only under Sakura) |
| `src/styles/tokens.css` | Base token set (Sakura dark) |
| `src/styles/themes/{dark,light}-themes.css` | The 10 Sakura palette overrides |
| `src/styles/obscura/*.css` | The whole Obscura aesthetic (tokens/components/motion/light) — imported **last** in `index.css` |

### CSS selector pattern

```css
/* Sakura dark default (no attributes) */
:root { --skr-bg: #0D0B14; ... }

/* Sakura non-default palette */
[data-theme="moonrise"] { --skr-bg: #08101A; ... }

/* Sakura light */
[data-brightness="light"][data-theme="moonrise"] { --skr-bg: #EDF6FE; ... }

/* Obscura dark ("canvas at night") — wins by cascade order (imported last) */
[data-aesthetic="obscura"] { --skr-bg: #0E0C09; --skr-font-display: "Cormorant Garamond", ...; }

/* Obscura light ("atelier at dawn") — 0,2,0 beats the shared light block */
[data-aesthetic="obscura"][data-brightness="light"] { --skr-bg: #F0E7D8; ... }
```

Accent colors are **identical in both brightness modes within Sakura** (color identity), while
Obscura deepens its gold in light mode for contrast on parchment.

---

## Aesthetics

| ID | Label | Language | Display / body fonts | Dark bg | Light bg | Accent |
|----|-------|----------|----------------------|---------|----------|--------|
| `sakura` | Sakura Bloom | Bright anime — pink neon, rounded, playful springs | Zen Kaku Gothic New / Noto Sans JP | per palette | per palette | per palette |
| `obscura` | Obscura | Dark painterly Belle Époque — gilt frames, vignette + canvas grain, slow no-overshoot motion | Cormorant Garamond / Spectral | `#0E0C09` ink | `#F0E7D8` parchment | `#C9A45C` gold (dark) / `#8F6B21` goldenrod ink (light) |

Obscura also overrides the radius tokens (`--skr-radius-sm/md/lg`: 8/12/20px → 4/6/10px) and the
motion tokens (`--skr-duration-*` slower, springs de-bounced): anything consuming the tokens
reskins for free.

**Known caveat — select arrows:** `<select>` dropdown chevrons are SVG **data-URIs** in
`background-image`, and `var()` cannot be interpolated inside a data-URI. Sakura's pink chevron
lives in `components.css`/`sanctum.css`; Obscura overrides it with a gold twin in
`obscura-components.css`. A third aesthetic needs its own copy.

---

## Sakura Color Palettes

| ID | Label | Accent | Secondary | Dark bg | Light bg |
|----|-------|--------|-----------|---------|----------|
| `sakura` | Sakura | `#FF6B9D` pink | `#C084FC` wisteria | `#0D0B14` indigo | `#FEF0F6` rose-white |
| `moonrise` | Moonrise | `#38BDF8` sky blue | `#818CF8` indigo | `#08101A` deep navy | `#EDF6FE` sky-white |
| `bamboo` | Bamboo | `#4ADE80` jade | `#FBBF24` gold | `#090F0B` dark forest | `#EDFAF2` mint-white |
| `ember` | Ember | `#F87171` coral red | `#FB923C` orange | `#120B08` volcanic | `#FEF0EC` warm cream |
| `void` | Void | `#A855F7` electric violet | `#22D3EE` neon cyan | `#06040F` near-black | `#F5EEFF` lavender-white |
| `glacier` | Glacier | `#2DD4BF` icy teal | `#94A3B8` slate | `#08100F` arctic dark | `#ECF8F7` icy white |
| `dusk` | Dusk | `#FB923C` amber orange | `#F472B6` warm rose | `#110D08` twilight | `#FFF4EB` warm parchment |
| `aurora` | Aurora | `#34D399` aurora green | `#22D3EE` cyan | `#050E10` deep blue-green | `#EAFAF4` pale mint |
| `crimson` | Crimson | `#F43F5E` scarlet | `#F59E0B` gold | `#0F0608` dark red | `#FEF0F2` pale rose |
| `storm` | Storm | `#FDE047` lightning yellow | `#94A3B8` silver | `#090C10` dark slate | `#F8F9EE` yellow-tinted paper |

---

## CSS Variables Reference

All design tokens use the `--skr-` prefix. **Every token must be defined in both aesthetics**
(Sakura value in `tokens.css` `:root`, Obscura value in `obscura/obscura-tokens.css`). The core set:

| Variable | Purpose |
|----------|---------|
| `--skr-bg` / `--skr-base` | Page background |
| `--skr-surface` / `--skr-elevated` / `--skr-card` | Panel surfaces |
| `--skr-accent` (+`-hover`, `-secondary`, `-info`, `-success`, `-warning`, `-danger`) | Accent family — tints derived via `color-mix(in srgb, var(--skr-accent) N%, transparent)`, never raw rgba literals |
| `--skr-text` (+`-primary`, `-inverse`, `-secondary`, `-muted`, `-tertiary`) | Text levels |
| `--skr-border` / `--skr-border-strong` / `--skr-overlay` / `--skr-glass` | Lines & sheets |
| `--skr-glow` / `--skr-glow-strong` / `--skr-shadow-sm/md/lg` | Depth (Sakura: neon glow; Obscura: candlelight + chiaroscuro shadow) |
| `--skr-gradient-surface/accent/hero/nav-active` | Derived gradients |
| `--skr-font-display` / `--skr-font-body` / `--skr-font-mono` | Typography |
| `--skr-radius-sm/md/lg` | Shape language |
| `--skr-ease-*` / `--skr-duration-*` | Motion language |
| `--skr-comp-*` | Companion panel chrome (referenced from inline style objects) |

---

## Adding a New Sakura Palette

1. Add an entry to `THEMES` in `src/contexts/ThemeContext.js` (`id`, `label`, `swatch`, `swatchSecondary`).
2. Add a `[data-theme="<id>"]` dark block in `src/styles/themes/dark-themes.css`.
3. Add a `[data-brightness="light"][data-theme="<id>"]` light block in `src/styles/themes/light-themes.css`.
4. Add the id to `SUPPORTED_THEMES` in `src/lib/agent/slashCommands.js`, `backend/lib/agent-tools/dispatchers.js`, and `VALID_THEMES` in `backend/lib/agent-state.js` (enum guards).
5. Build and deploy: `npm --prefix frontend run build` then `npm --prefix cdk run idea:deploy -- --stage=dev`.

## Adding a New Aesthetic (or Obscura sub-palette)

An aesthetic is a bigger commitment than a palette — follow the Obscura shape (see ADR-010):
a `styles/<name>/` directory (tokens + components + motion + light) imported at the end of
`index.css`, an entry in `AESTHETICS` in `ThemeContext.js`, the pre-paint script fallback,
the enum guards (frontend slash command, backend dispatcher + `VALID_AESTHETICS`), and a
select-arrow data-URI copy. Obscura sub-palettes are simpler: a
`[data-aesthetic="obscura"][data-obscura-palette="<id>"]` token block — the axis exists but no
sub-palettes ship in v1.
