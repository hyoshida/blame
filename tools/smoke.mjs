// Headless smoke test: loads the build in a phone viewport, starts a game,
// fires a few shots via touch drags and saves screenshots to ./shots/.
// Needs playwright: NODE_PATH=$(npm root -g) node tools/smoke.mjs
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = 'file://' + new URL('../dist/index.html', import.meta.url).pathname;
const out = new URL('../shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function drag(x0, y0, x1, y1) {
  const cdp = await ctx.newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

await page.goto(url);
await page.waitForTimeout(800);
await page.screenshot({ path: out + '1-title.png' });
await page.tap('#btnNew');
await page.waitForTimeout(500);
await drag(250, 400, 250, 480); // aim down -> fly up
await page.waitForTimeout(250);
await drag(250, 400, 180, 470); // down-left -> up-right
await page.waitForTimeout(120);
await page.screenshot({ path: out + '2-shot.png' });
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '3-landed.png' });

await page.goto('about:blank');
await page.goto(url + '#row40');
await page.waitForTimeout(500);
await page.tap('#btnNew');
if (await page.isVisible('#btnNew')) await page.tap('#btnNew'); // confirm overwrite
await page.waitForTimeout(700);
await page.screenshot({ path: out + '4-chimney.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
