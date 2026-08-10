# Design Tokens — Dark macOS Glass

> The UI is a dark, layered "macOS glass" system: near-black canvas, white-alpha
> surfaces, hairline borders, backdrop-blur panels, coral CTA. All components
> consume tokens; never hardcode hex colors in components.

## Token map (`frontend/src/index.css` `@theme`)

| Token | Value family | Role |
|---|---|---|
| `canvas` | `#131315` | app background (near-black) |
| `surface-soft/card/cream-strong` | white alpha 5/8/12% | glass layer steps (hover → active → raised) |
| `surface-dark(-elevated/-soft)` | `#0b0b0c` / `#232326` / `#1a1a1d` | inset code blocks, popovers |
| `ink` | `#f4f2ed` | primary text (light on dark) |
| `body` / `muted` / `muted-soft` | gray ramp | secondary text ramp |
| `hairline(-soft)` | white alpha 9/5% | all borders/dividers |
| `primary` | `#cc785c` coral | CTA + active accents only |

shadcn bridge vars (`:root`) map onto these tokens; shadcn primitives
(button/input/tabs/dialog/…) adapt automatically when tokens change.

## Glass primitives (component classes)

- `.glass` / `.glass-strong` — translucent white surface + `backdrop-filter: blur(...)`.
  Always pair with an explicit Tailwind border (`border border-hairline`) and radius
  (`rounded-xl` / `rounded-2xl`); the utility itself carries no border/radius.
- `--glass-opacity-soft` / `--glass-opacity-strong` (`@theme` tokens) — the single tunable
  alpha source for `.glass` / `.glass-strong`'s `color-mix()` background. Adjust overall
  glass translucency here only; never hardcode a new alpha percentage in a component.
- `.ambient-bg` — fixed radial coral/teal glows behind the whole shell; glass panels
  refract it. One instance at the app root (`App.tsx`), `pointer-events-none`.
- `.card-shadow` — depth shadow for raised glass cards.

## Button variants (`components/ui/button.tsx`)

- `primary` — coral CTA, the only high-emphasis action per surface (e.g. 下载/登录).
- `secondary` — translucent glass surface (`bg-surface-card` + hairline border), same
  material family as `.glass`/`.glass-strong` panels, for medium-emphasis actions
  (e.g. 检测/测试连接/取消). Never use opaque `bg-canvas` here — see Forbidden.
- Do **not** add `backdrop-filter`/`backdrop-blur` directly on buttons: nested
  `backdrop-filter` inside an already-blurred `.glass`/`.glass-strong` ancestor filters
  the parent's composited result, not the ambient layer, and reads as a muddy patch
  instead of the intended translucency. A `surface-*` token background is sufficient.

## Layout shell conventions

- Shell = left glass sidebar (`w-[232px]`, `glass-strong`, `border-r border-hairline`)
  + main workspace; both sit above the ambient layer (`relative z-10`).
- macOS Overlay titlebar: sidebar top `h-12` drag region gets `pl-[70px]` on macOS
  (`isMac` UA check); main column has its own `h-12` `data-tauri-drag-region` strip.
- Views are switched by sidebar nav (`home` / `settings`); settings is a full view,
  not a dialog. Transient editors (custom prompt) stay dialogs.
- Home has two phases: hero (greeting + `UrlForm variant="hero"` + mode cards) when
  idle, compact toolbar (`UrlForm variant="compact"`) + `ResultPanel` once a run starts.

## Forbidden

- Hardcoded light-mode colors or new cream palette values.
- Opaque `bg-canvas` panels inside the workspace (kills the glass layering);
  use `.glass` + hairline border instead. This includes buttons — `secondary` must
  stay on a translucent `surface-*` token, not `bg-canvas`.
- Per-component color overrides; adjust tokens in `index.css` instead.
- Hardcoding a new glass alpha percentage in a component instead of reusing
  `--glass-opacity-soft` / `--glass-opacity-strong`.
