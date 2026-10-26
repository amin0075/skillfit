---
name: playwright-e2e-testing
description: Write, fix, or review Playwright end-to-end tests, especially for Next.js apps - locators, auth via storageState, flaky waits, server-side fetch mocking, CI against a production build. Use for *.spec.ts / e2e/ / playwright.config changes or flaky browser tests. For unit and component tests use frontend-testing.
---

# Playwright E2E

## Start from repository evidence

1. Read `AGENTS.md` and the testing page linked from `docs/agent/index.md`.
2. Read `playwright.config.*` (`testDir`, `projects`, `webServer`, `use.baseURL`, `testIdAttribute`), existing fixtures, page objects, and the auth setup project.
3. Use the repo's package manager and scripts. Match existing file names, tags, and fixture style; do not introduce page objects or new fixtures if the suite does not use them.

## Rules that prevent flaky tests

- **Locators:** `getByRole` with `name`, then `getByLabel`, `getByText`, then `getByTestId` (respect a configured `testIdAttribute`). No CSS chains, XPath, or `.nth()` on unstable lists.
- **Waiting:** only web-first assertions (`await expect(locator).toBeVisible()`, `toHaveURL`, `toHaveText`). Never `waitForTimeout`. Avoid `waitForLoadState("networkidle")`: Next.js prefetching and streaming keep the network busy. After navigation use `await expect(page).toHaveURL(...)` or `page.waitForURL`.
- **Hydration:** a click on a server-rendered button before hydration can be lost. Assert the result of the interaction (a visible state change), not just that the click ran; if the suite has a hydration-ready helper, use it.
- **Server Actions / forms:** assert on the UI that the action produces (toast, updated row, redirect URL), not on internal network calls.
- **Isolation:** every test creates the data it needs (API or DB fixture) and can run in parallel and in any order. No dependence on a previous test.
- **Auth:** log in once in a setup project and save `storageState` per role; tests reuse it. Do not log in through the UI in every test.

## Next.js specifics

- **CI runs against a production build** (`next build` then `next start`) through `webServer`; `next dev` compiles routes on first hit and causes timeouts. Use `reuseExistingServer: !process.env.CI` locally.
- **`page.route` only intercepts browser requests.** Fetches made by Server Components, Route Handlers, or Server Actions run on the server and are not intercepted. Point the server at a test backend/database via env, or use the repo's existing server-side mocking (MSW in the server, or `next/experimental/testmode/playwright` if already set up).
- **Instant navigation / static shell guards** under Cache Components: use the `next-cache-components-optimizer` skill (`@next/playwright` `instant()`).
- **Visual snapshots:** fixed viewport, `animations: "disabled"`, mask dynamic regions (dates, avatars). Snapshots are per OS/browser; only update them on the platform CI uses.

## Run and debug

- Narrow first: `<pm> playwright test <file> -g "<title>" --project=chromium`.
- Flaky: `--repeat-each=10 --workers=1`, then `--trace on` and `playwright show-trace`.
- Report the exact command, pass/fail, and any test you could not run (for example missing env or seed data).
