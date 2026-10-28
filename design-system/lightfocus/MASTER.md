# LightFocus v3 — Apple Liquid Glass Design System (MASTER.md)

> **LOGIC:** This document defines the official **Apple Liquid Glass (iOS 26 / macOS Tahoe / visionOS)** Design System for **LightFocus v3 (Commercial SaaS Edition)**.
> Every surface, token, interaction, and responsive rule in `index.html`, `styles.css`, and `app.js` strictly adheres to these specifications.

---

**Project:** LightFocus v3 — Commercial Multi-User SaaS
**Style:** Apple Liquid Glass (`liquid-glass` + Swiss Minimal Precision)
**Modes:** Light Pearl Glass (Default) & Dark Obsidian Glass (Toggleable)

---

## 1. Core Material & Optical Principles

1. **Zero Mascots / Zero Cartoon Palette**:
   - No Miss Minutos mascot, no traffic-light orange/yellow/red progress bars, no playful cartoon badges.
   - Pure optical glass lensing, monochrome hierarchy, and judicious Apple system accents.
2. **Zero Native Emojis**:
   - Every icon in the UI is rendered via crisp thin-stroke vector SVG (`stroke-width: 1.75`, `stroke-linecap: round`, `stroke-linejoin: round`).
   - Any emoji characters inside external Todoist task strings or descriptions are stripped/sanitized automatically at render time.
3. **1:1 Geometric Integrity**:
   - Every circular check button, avatar, icon orb, and activity ring enforces `aspect-ratio: 1 / 1; flex-shrink: 0` so circles never squash on mobile or narrow containers.
4. **Mobile-First Responsive Wrapping**:
   - Long task titles and descriptions use `overflow-wrap: anywhere; word-break: break-word` with an inline `Expandir / Recolher` toggle and zero horizontal scroll at `375px`, `768px`, `1024px`, and `1440px`.

---

## 2. Color & Material Tokens

### Light Pearl Glass (Default Mode)
| Token | Value | Role |
|-------|-------|------|
| `--bg-canvas` | `#F5F5F7` | Apple alabaster base canvas |
| `--bg-canvas-secondary` | `#ECEEF2` | Cool silver-pearl secondary depth |
| `--glass-surface` | `linear-gradient(135deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.46) 100%)` | Primary Liquid Glass card & bar material |
| `--glass-surface-elevated` | `linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(255, 255, 255, 0.68) 100%)` | Floating modals, Spotlight (`⌘K`), Quick-Add (`Q`) |
| `--glass-pill` | `rgba(255, 255, 255, 0.62)` | Interactive capsule pills & chips |
| `--glass-blur` | `blur(32px) saturate(190%)` | Optical backdrop filter |
| `--glass-border` | `rgba(255, 255, 255, 0.85)` | Specular refractive outer rim |
| `--glass-border-subtle` | `rgba(15, 23, 42, 0.07)` | Hairline structural divider |
| `--glass-inner-highlight` | `inset 0 1px 0.5px rgba(255, 255, 255, 0.95), inset 0 -1px 0.5px rgba(15, 23, 42, 0.04)` | Top specular edge + bottom depth |
| `--glass-shadow` | `0 20px 48px -12px rgba(15, 23, 42, 0.06), 0 4px 14px -2px rgba(15, 23, 42, 0.03)` | Ambient elevation shadow |
| `--ink-primary` | `#1D1D1F` | Primary Apple obsidian ink |
| `--ink-secondary` | `#515154` | Secondary body & description ink |
| `--ink-tertiary` | `#86868B` | Muted metadata, kbd hints, timestamps |
| `--accent-blue` | `#0071E3` | Apple System Blue (focus ring, active states, links) |
| `--accent-obsidian` | `#1D1D1F` | Primary Apple pill button surface |
| `--refraction-pulse` | `rgba(0, 113, 227, 0.18)` | Luminous focus completion refraction wave |

### Dark Obsidian Glass (`[data-theme="dark"]`)
| Token | Value | Role |
|-------|-------|------|
| `--bg-canvas` | `#0B0C10` | Deep spatial obsidian canvas |
| `--bg-canvas-secondary` | `#121318` | Secondary dark depth |
| `--glass-surface` | `linear-gradient(135deg, rgba(30, 32, 40, 0.72) 0%, rgba(20, 22, 28, 0.52) 100%)` | Dark Liquid Glass surface |
| `--glass-surface-elevated` | `linear-gradient(135deg, rgba(38, 41, 52, 0.86) 0%, rgba(24, 26, 34, 0.76) 100%)` | Elevated dark modal surface |
| `--glass-border` | `rgba(255, 255, 255, 0.14)` | Dark specular rim |
| `--ink-primary` | `#F5F5F7` | Primary alabaster ink |
| `--ink-secondary` | `#A1A1A6` | Secondary silver ink |
| `--ink-tertiary` | `#6E6E73` | Muted metadata ink |
| `--accent-blue` | `#2997FF` | Luminous Apple Dark Blue |

---

## 3. Typography & Spacing Scale

- **UI Sans Font:** `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Plus Jakarta Sans', sans-serif`
- **Tabular Numerals & Shortcuts:** `'JetBrains Mono', 'SF Mono', monospace` (`font-variant-numeric: tabular-nums`)
- **Spacing Tokens:**
  - `--space-xs`: `4px`
  - `--space-sm`: `8px`
  - `--space-md`: `16px`
  - `--space-lg`: `24px`
  - `--space-xl`: `32px`
  - `--space-2xl`: `48px`
- **Radii:**
  - `--radius-xs`: `8px`
  - `--radius-sm`: `12px`
  - `--radius-md`: `18px`
  - `--radius-lg`: `24px`
  - `--radius-xl`: `30px`
  - `--radius-pill`: `9999px`

---

## 4. Key SaaS Workflows & Shortcuts

1. **Multi-User Commercial Auth (`/api/auth/register`, `/api/auth/login`)**:
   - Segmented Liquid Glass switcher (`Entrar` | `Criar Conta`).
   - Instant onboarding with sample tasks or live Todoist API connection.
2. **Quick-Add Task Sheet (`Q`)**:
   - Triggered by pressing `Q` (outside inputs) or clicking `+ Nova Tarefa · Q`.
   - Real-time NLP schedule parser converting tokens (`hoje`, `amanha`, `seg..dom`, `DD/MM`, `14:00`, `15m`, `25m`, `1h`, `p1..p4`, `todo dia`, `#projeto`) into interactive glass chips.
3. **Spotlight Search & Command Palette (`⌘K` / `Ctrl+K`)**:
   - Instant fuzzy search across tasks + 1-keystroke execution of timer, completion, theme toggle, Todoist sync, and XP reports.
4. **Minimalist Activity & XP System**:
   - Concentric SVG progress ring + monochrome level progression (`Nível 1 · Cristal` to `Nível 10 · Arquitetônico`), `+50 XP` per completed task, `+5 XP` per focused minute.
