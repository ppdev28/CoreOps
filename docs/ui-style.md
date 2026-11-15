# CoreOps application visual system

Updated 2026-11-13 on `feature/ui-redesign`. The rounded monochrome Dashboard direction now applies to **every screen**, following the user's expanded scope. The default remains neutral; accent colors and Dark/Gray/Light/System are configurable under Settings → Appearance.

The favicon in `frontend/public/favicon.svg` uses the same neutral server-outline identity; its relative link supports the configured Vite base and the browser theme color matches the dark canvas.

## Scope and components

The common material covers Dashboard, Host, Containers and inspect, Applications, Services, Storage, Network, Virtual machines, Monitoring, Logs, Terminal, Security, Updates, Settings and login. Navigation order, existing operational capabilities, roles and API contracts are preserved. Unimplemented operations stay unavailable; no demo infrastructure data is installed in the application.

- `src/lib/appearance.ts`: pure palette policy, eight accent presets, color validation, contrast calculation and theme resolution.
- `src/lib/webSettings.ts`: local persistence and validation (`accentColor` defaults to `neutral`; custom values must be six-digit hex). Existing settings migrate implicitly through defaults.
- `src/lib/tokens.ts`: cached, live shared tokens and root CSS variables; saved changes and System preference changes update every view without reloading. Semantic status tokens remain independent of accent.
- `src/styles/themes.css`, `dashboard.css`, `application.css`: foundation variables, flat material/components and application-wide responsive rules. `.app-workspace` covers the shell/login; `.dashboard-popover` gives portaled popovers the same resolved tokens. `material.css` contains earlier shared definitions overridden by the flat material.
- `src/components/ui.tsx`: existing public visual primitives now use flat rounded cards, pill buttons/filters/tabs and shared appearance. Their props and operational callbacks are preserved.
- `src/components/ui/`: locally owned shadcn/ui primitives (MIT); Dashboard uses these plus TanStack Table v8.
- `src/components/tremor/`: vendored Tremor Raw LineChart/SparkLineChart and helpers, with licenses retained. Dashboard preserves real sample gaps and chart range state. `dashboard-theme.ts` now re-exports the common tokens rather than defining another palette.
- `src/components/dashboard.tsx`: reusable Dashboard product components. `dashboard/ServerSelector.tsx` supplies the current-host popover throughout the shell.
- Inter Variable / Inter and JetBrains Mono are served locally. Metrics/timestamps/numeric columns use tabular figures; technical values use monospace. External Google font imports have been removed.

## Material and themes

Dark uses `#090909` canvas, `#171717` cards, `#222222` nested surfaces, `#272727` secondary controls and `#2d2d2d` borders. Gray uses brighter graphite surfaces. Light uses neutral pale surfaces and dark text. System tracks the OS's light/dark preference.

Major cards have roughly 24–26px radii, nested surfaces 16–20px, and compact controls full pill corners. Surfaces are flat with restrained borders and no neumorphic bevels. Keyboard focus remains explicit. Terminal input focus is drawn on its surrounding input surface, avoiding nested rings.

Accent presets: **Neutral, Blue, Indigo, Violet, Teal, Green, Amber, Rose**, plus a custom color picker. The selection is saved alongside the theme and survives reload/navigation. The preview is explicitly a draft until Save. Neutral adapts its button fill to light/dark. Custom fills retain the chosen color; foreground is selected for contrast, and text/focus accents are lightened/darkened when needed to reach 4.5:1 against card surfaces. Status success/warning/error colors do not change with accent.

## Responsive behavior

| Width / situation | Behavior |
| --- | --- |
| Under 768px | Existing navigation drawer; wrapping controls; stacked detail grids; comfortable touch targets; two-column Dashboard metrics |
| 768–1150px | Compact 64px sidebar; reflowed summary grids; content columns shrink safely |
| Laptop / desktop | Full navigation and adaptive content grids, bounded readable widths |
| Large desktop | Centered content with bounded maximum widths instead of stretched tables/forms |
| Short landscape viewport | Compact header and spacing; main/terminal areas scroll within the available dynamic viewport height |

View grids have explicit `data-layout` markers; standalone panels use `data-surface`. Dense operational tables scroll inside their own containers, not the page. Dashboard container rows stack on phones. Applications wrap their actions on very narrow phones. Network uses an intrinsic `minmax(0,1fr)` column so wide interface tables do not force page overflow. Settings navigation wraps into compact section controls on phones.

The root uses dynamic viewport height (`100dvh`). Native WebView content receives the common responsive styling. Default Android chrome / Android and iOS launch colors align with the neutral material; native chrome still has its own static palette and does not mirror custom web accents or light mode. Native builds/device validation remain pending.

## Operational behavior

The Dashboard's Bento order stays health → metrics → trends → containers/system → activity/actions. Online connectivity remains separate from health. Lifecycle and health-check status remain distinct. CPU/memory/storage thresholds and observed container issues are actionable; healthy status explicitly scopes itself to available resource/container checks.

History is real session data, at most 24 hours / 17,280 samples. Missing/non-finite samples and long gaps remain gaps; selected ranges survive updates. Stale/last-known values and unavailable earlier history are labelled. Network rates need two monotonic samples. Temperature remains unavailable without API support. Container creation stays disabled until implemented.

## Validation

```bash
cd frontend
pnpm build
pnpm format:check
pnpm exec playwright install chromium   # once, if needed
pnpm test:ui
```

An existing Chromium can be selected with `COREOPS_CHROMIUM_PATH=/path/to/chrome pnpm test:ui`. `test:dashboard` remains an alias for the same suite.

The 15 Playwright tests use intercepted API fixtures and wait for actual screen content after lazy loading. They cover all 14 navigation destinations plus container inspection at 320×740, 390×844, 844×390, 768×1024, 1024×768, 1280×800, 1920×1080 and 2560×1440; they check page overflow and runtime errors. Other tests cover live presets/custom accents, persistence, malformed settings, System changes, login, sorting, role restrictions, chart ranges/gaps and healthy/issue/empty/disconnected/stale states. Tables can legitimately scroll horizontally inside their regions.

Screenshots live in ignored `frontend/test-results/dashboard/` artifacts. Fixture terminal responses are intercepted, including its initial identity query; no real infrastructure command is run by these tests. Real authenticated API integration, native builds and physical device coverage are not claimed. Existing warnings: `uuid@7.0.3` deprecation from Capacitor CLI → xcode, and Playwright terminal color-environment notices.

Source references: [shadcn Table](https://ui.shadcn.com/docs/components/radix/table), [Tremor Raw](https://www.tremor.so/docs/getting-started/installation), [TanStack v8](https://tanstack.com/table/v8/docs/overview). Retain notices in `frontend/licenses/` when editing vendored components.
