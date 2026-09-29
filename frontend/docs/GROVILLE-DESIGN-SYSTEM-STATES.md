# GROVILLE DESIGN SYSTEM — Interaction States (v1)

Companion to `DESIGN.md v3` (dark) and `GROVILLE-LIGHT-DESIGN-SYSTEM.md` (light).
This file adds the missing layer: **how every interactive element behaves** —
DEFAULT / HOVER / PRESSED / SELECTED / FOCUS / DISABLED — in both themes.

**Source of truth = CSS variables.** Use the `.btn`, `.navlink`, `.tab`, `.icon-btn`,
`.card--interactive` classes directly in the Claude Design HTML today; map the same
tokens into `tailwind.config` + component variants when we build the dashboards in the repo.

Derived from the Groville Figma state matrix (Tab Button / Navlink / Text Buttons /
Mode / Button Group / Button Container) re-skinned to Groville tokens, plus WCAG 2.2 AA
focus + contrast rules.

---

## 1. Two hard Groville rules (these fix current complaints)

1. **Shadows are theme-tinted. Never a blue bloom.**
   - Dark: cool, near-black shadows.
   - Light (warm cream): **warm brown-tinted** shadows only. No blue glow on any surface.
2. **Focus is always visible.** Every interactive element gets a `:focus-visible` ring
   (keyboard/AT users). Ring ≥ 3:1 contrast against its background.

Bonus fix baked in: the light-mode muted text tokens below are **darker/warmer than the
old `#64748B`**, which is the root cause of the "dull / illegible fonts" you flagged.

---

## 2. Tokens

```css
/* ================= DARK (default — landing + dashboards) ================= */
:root {
  /* surfaces */
  --canvas: #04060F;            /* landing */
  --canvas-dash: #031130;       /* dashboards */
  --surface: #0A1A3A;
  --surface-raised: #0F2145;
  --surface-hover: #13284F;     /* +hover step */
  --border: #1B2C50;
  --border-strong: #2A3E6B;

  /* text */
  --text: #F3F7FE;
  --text-secondary: #C3CFE8;    /* was too dim before */
  --text-muted: #93A2C6;

  /* brand */
  --primary: #185DF1;
  --primary-hover: #3B76F3;     /* +8% L */
  --primary-active: #1149C7;    /* -10% L */
  --success: #2FBF71;

  /* interaction */
  --focus: #6FA0FF;             /* lighter blue reads on dark */
  --tint: rgba(24,93,241,.16);  /* ghost/hover tint */
  --tint-strong: rgba(24,93,241,.26);
  --shadow-hover: 0 6px 20px rgba(0,0,0,.45);
  --shadow-press: 0 2px 6px rgba(0,0,0,.35);

  /* cards + elevation (dark lifts via LIGHTER surface + gradient) */
  --section-sunken: #04060F;    /* canvas already darker than cards */
  --card-fill: linear-gradient(180deg,#0F2145 0%,#0A1A3A 100%);
  --card-fill-accent: linear-gradient(160deg,#1B4FD1 0%,#123A9E 100%);  /* hero card */
  --elev-card: 0 8px 30px rgba(0,0,0,.45);
  --elev-card-hover: 0 12px 40px rgba(0,0,0,.55);
  --chip-tint: rgba(24,93,241,.20);

  /* shape + motion */
  --radius-btn: 9999px;         /* mobile-first = pill */
  --radius-card: 16px;
  --ease: cubic-bezier(.2,0,0,1);
  --dur-color: 150ms;
  --dur-move: 120ms;
}

/* ================= LIGHT (warm cream) ================= */
[data-theme="light"] {
  --canvas: #F6F1E8;
  --canvas-dash: #F6F1E8;
  --surface: #FFFFFF;
  --surface-raised: #FFFFFF;
  --surface-hover: #FBF8F2;
  --border: #D8CFBD;
  --border-strong: #C4B79D;     /* hover border */

  --text: #1B1A17;
  --text-secondary: #4A5568;    /* bumped from #64748B for legibility */
  --text-muted: #6B6456;        /* warm, AA on cream */

  --primary: #185DF1;
  --primary-hover: #3B76F3;
  --primary-active: #1149C7;
  --success: #1E9E5A;           /* darker green for AA on white */

  --focus: #185DF1;
  --tint: rgba(24,93,241,.08);
  --tint-strong: rgba(24,93,241,.14);
  --shadow-hover: 0 6px 18px rgba(60,48,28,.12);   /* WARM, no blue */
  --shadow-press: 0 2px 6px rgba(60,48,28,.10);

  /* cards + elevation (light lifts via SHADOW + sunken section bg) */
  --section-sunken: #EFE7D6;    /* deeper cream so white cards float above it */
  --card-fill: linear-gradient(180deg,#FFFFFF 0%,#FCFAF5 100%);
  --card-fill-accent: linear-gradient(160deg,rgba(24,93,241,.07) 0%,#FFFFFF 55%);  /* hero: blue-tint fill, warm shadow, NO blue glow */
  --elev-card: 0 1px 2px rgba(60,48,28,.06), 0 8px 24px rgba(60,48,28,.10);  /* layered, ambient <=.15 */
  --elev-card-hover: 0 2px 4px rgba(60,48,28,.08), 0 14px 32px rgba(60,48,28,.14);
  --chip-tint: rgba(24,93,241,.10);
}

/* desktop = rounded-rect */
@media (min-width: 768px) {
  :root, [data-theme="light"] { --radius-btn: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
```

---

## 3. Generic state deltas (apply to everything)

| State | What changes |
|---|---|
| **Default** | base bg/text/border |
| **Hover** | bg → `-hover` token, `translateY(-1px)`, `--shadow-hover` |
| **Pressed** | bg → `-active` token, `translateY(0) scale(.98)`, `--shadow-press` |
| **Focus-visible** | `outline: 2px solid var(--focus); outline-offset: 2px` (keep on top of hover) |
| **Selected** | persistent filled/underlined state (per component below) |
| **Disabled** | `opacity:.45; pointer-events:none` (or `cursor:not-allowed`), no transform |

Transitions: `transition: background var(--dur-color) var(--ease), color var(--dur-color) var(--ease), transform var(--dur-move) var(--ease), box-shadow var(--dur-color) var(--ease);`

---

## 4. Components

### 4.1 Primary button — `.btn.btn--primary`
| State | Dark | Light |
|---|---|---|
| Default | bg `--primary`, text `#FFF` | same |
| Hover | bg `--primary-hover`, lift + shadow | same (warm shadow) |
| Pressed | bg `--primary-active`, scale .98 | same |
| Focus | `--focus` ring | `--focus` ring |
| Disabled | opacity .45 | opacity .45 |

### 4.2 Secondary button — `.btn.btn--secondary`
| State | Dark | Light |
|---|---|---|
| Default | bg `--surface-raised`, 1px `--border`, text `--text` | bg `#FFF`, 1px `--border`, text `--text` |
| Hover | bg `--surface-hover`, border `--border-strong` | bg `--surface-hover`, border `--border-strong` |
| Pressed | bg `--surface`, scale .98 | bg `#F0EADD`, scale .98 |
| Focus | ring | ring |
| Disabled | opacity .45 | opacity .45 |

### 4.3 Ghost / Text button — `.btn.btn--ghost` (e.g. "See how I'd do it", dashboard "Draft")
| State | Both themes |
|---|---|
| Default | transparent bg, text `--primary` (or `--text-secondary` for neutral ghosts) |
| Hover | bg `--tint`, text `--primary-hover` |
| Pressed | bg `--tint-strong`, scale .98 |
| Focus | ring |
| Disabled | opacity .4 |

### 4.4 Navlink — `.navlink` (top nav: Platform / How it works / Pricing)
| State | Behavior |
|---|---|
| Default | text `--text-secondary`, no underline |
| Hover | text `--text`, animated underline grows in (`--primary`, 2px) |
| Pressed | opacity .8 |
| **Selected (current page)** | text `--text`, **persistent 2px `--primary` underline** (matches Image 3 active "Pricing") |
| Focus | ring around link box |
| Disabled | text `--text-muted` |

### 4.5 Tab / Segmented — `.tab` (e.g. dashboard "This week", any pill toggle)
| State | Dark | Light |
|---|---|---|
| Default | transparent, text `--text-secondary` | same |
| Hover | bg `--tint` | bg `--tint` |
| Pressed | bg `--tint-strong` | bg `--tint-strong` |
| **Selected** | filled chip: bg `--surface-raised`, 1px `--border`, `--shadow-press`, text `--text` | filled chip: bg `#FFF`, warm shadow, text `--text` |
| Disabled | opacity .45 | opacity .45 |

### 4.6 Icon / Mode toggle — `.icon-btn` (sun/moon, bell)
| State | Behavior |
|---|---|
| Default | circular, icon `--text-secondary`, transparent/subtle bg |
| Hover | bg `--tint`, icon `--text` |
| Pressed | `scale(.95)` |
| Selected (active mode) | ring or filled `--primary` bg per placement |
| Focus | ring |

### 4.7 Interactive card — `.card--interactive` (gap cards, pricing cards)
| State | Behavior |
|---|---|
| Default | `--surface` / `#FFF`, 1px `--border`, `--radius-card` |
| Hover | border `--border-strong`, `translateY(-2px)`, `--shadow-hover` |
| Pressed | `translateY(0)`, `--shadow-press` |
| Focus (if clickable) | ring |

### 4.8 Elevated / content card — `.card-elevated` (mockup floats, capabilities, numbers, testimonials, FAQ, pricing)
The premium card. **Dark and light lift differently** — never mix the two systems:
- **Dark** lifts by making the surface *lighter than the canvas* (via `--card-fill` gradient) + a soft shadow.
- **Light** lifts by *shadow* (`--elev-card`, layered + warm) while sitting on a **sunken section** (`.section--cards` = `--section-sunken`), so a white card floats above deeper cream.

```css
.card-elevated { background: var(--card-fill); border: 1px solid var(--border);
                 box-shadow: var(--elev-card); border-radius: var(--radius-card); }
.card-elevated:hover { box-shadow: var(--elev-card-hover); transform: translateY(-2px); }
.card-accent  { background: var(--card-fill-accent); }   /* hero/featured card; shadow stays warm — NO blue glow */
.section--cards { background: var(--section-sunken); }    /* wrap card sections so cards pop */
```
Rules:
- Icon chips inside cards: `background: var(--chip-tint)`, icon in `--primary`.
- **Numbers, stats & data-viz never go pale.** Big numbers → `--text` bold (or `--primary` to highlight one metric); muted labels → `--text-muted`; bars / lines / dot-grids / sliders → `--primary` full strength.
- One focal card per section max gets `.card-accent`.

---

## 5. Accessibility (non-negotiable)
- Use `:focus-visible`, not `:focus` (no ring on mouse click, ring on keyboard).
- Text contrast ≥ **4.5:1** (body) / **3:1** (large & UI). Tokens above are chosen to pass.
- Touch targets ≥ **44×44px** on mobile.
- Disabled controls get `aria-disabled="true"`; keep them out of the tab order.
- Icon-only buttons need `aria-label`.

## 6. How to apply
- **Claude Design (landing, HTML now):** drop the `:root` / `[data-theme="light"]` blocks
  into the stylesheet, add the component classes, toggle `data-theme` on `<html>`.
- **Next.js repo (dashboards / ported landing):** put the vars in `globals.css`, mirror
  the semantic names in `tailwind.config`, and express variants with `cva`/shadcn so
  `<Button variant="primary" />` etc. carry every state automatically.
