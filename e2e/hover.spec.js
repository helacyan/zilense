/* hover.spec.js — Playwright E2E for ordinary-page hover → side panel.
   The demo article wraps each character in a <span>; Chrome's caret API can
   return that element instead of its text node. This covers the shared driver
   path (content script → worker → panel) on a tiny HTML page.

   Run `npm run build` first. */
import { test, chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(__dirname, '../dist')

const READER_URL = 'https://zilense.test/reader'
const READER_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
  <title>我的中文生活</title>
  <style>
    body { font-size: 28px; font-family: sans-serif; padding: 40px; }
    .tok { display: inline; }
  </style>
</head><body>
  <p lang="zh"><span class="tok" id="wo">我</span><span class="tok">是</span><span class="tok">学</span><span class="tok">生</span>。</p>
</body></html>`

let context
let extId

test.beforeAll(async () => {
  expect(existsSync(resolve(distDir, 'manifest.json')), 'run `npm run build` first').toBeTruthy()
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--headless=new`,
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
    ],
  })
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')
  extId = new URL(sw.url()).host
})

test.afterAll(async () => { await context?.close() })

test('HTML page: hovering 我 highlights and updates the side panel', async () => {
  const page = await context.newPage()
  await page.route(`${READER_URL}*`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: READER_HTML }))
  await page.goto(READER_URL)

  const wo = page.locator('#wo')
  await expect(wo).toBeVisible({ timeout: 15_000 })

  // open the side panel page in the same context so we can assert its live update
  // (chrome.sidePanel UI isn't reachable from Playwright; the panel page listens
  // for the same runtime 'show' message the docked panel would).
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`)
  await expect(panel.getByText('Hover a character to begin')).toBeVisible({ timeout: 30_000 })

  await page.bringToFront()
  await wo.hover()

  // on-page highlight proves the content-script caret → hover path worked
  await expect
    .poll(() => page.evaluate(() => 'highlights' in CSS && CSS.highlights.has('mydict-tok')),
      { timeout: 45_000, intervals: [400, 800, 1200] })
    .toBe(true)

  // worker relays { type: 'show', q: '我' } to every extension page listener
  await expect(panel.locator('.hanzi-big')).toContainText('我', { timeout: 30_000 })

  await panel.close()
  await page.close()
})
