// Headless smoke test: loads the build in a phone viewport, plays a few shots with
// touch drags and saves screenshots to ./shots/.
// Needs playwright: NODE_PATH=$(npm root -g) node tools/smoke.mjs
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = 'file://' + new URL('../dist/index.html', import.meta.url).pathname;
const out = new URL('../shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts/.test(m.text())) errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
async function drag(x0, y0, x1, y1, { hold = 0, shot = null } = {}) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 5; i++) await touch('touchMove', x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5);
  if (hold) await page.waitForTimeout(hold);
  if (shot) await page.screenshot({ path: out + shot });
  await touch('touchEnd');
}
async function start(hash = '') {
  await page.goto('about:blank');
  await page.goto(url + hash);
  await page.waitForTimeout(400);
  await page.tap('#btnNew');
  if (await page.isVisible('#scrTitle')) await page.tap('#btnNew');
  await page.waitForTimeout(600);
}

await page.goto(url);
await page.waitForTimeout(600);
await page.screenshot({ path: out + '1-title.png' });
await start();
await page.screenshot({ path: out + '2-start-sign.png' });
await drag(200, 500, 110, 540, { hold: 200, shot: '3-aiming.png' }); // shoot down-left -> fly right
await page.waitForTimeout(900);
await page.screenshot({ path: out + '4-after.png' });
await start('#at120,547');                                      // next to the first magazine
await drag(200, 400, 140, 400); // shoot left -> slide right onto the item
await page.waitForTimeout(1200);
await page.screenshot({ path: out + '5-item.png' });
if (await page.isVisible('#btnItemOk')) await page.tap('#btnItemOk');
await start('#row393');                                         // glass hall top: sensor in glass
await drag(200, 400, 262, 372, { hold: 200, shot: '6-aim-target.png' });
await start('#row316');
await page.screenshot({ path: out + '7-magnum.png' });
await start('#row289');
await page.screenshot({ path: out + '8-summit.png' });
await start('#at124,239');
await page.screenshot({ path: out + '9-crown.png' });
await start('#at16,137');
await page.screenshot({ path: out + '10-chute.png' });
await start('#at92,7');
await page.screenshot({ path: out + '11-gate.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
