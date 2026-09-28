// Inlines src/*.js into a single self-contained HTML page.
//   dist/index.html    — full document (GitHub Pages / any static host)
//   dist/artifact.html — body-only variant for the claude.ai artifact host
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
{ // a repeated row number in the tower table silently overwrites a row: refuse to build
  const lv = read('src/level.js'), t = lv.slice(lv.indexOf('const T = {'), lv.indexOf('};', lv.indexOf('const T = {')));
  const keys = [...t.matchAll(/^\s+(\d+): '/gm)].map((m) => m[1]);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dup.length) { console.error('level.js: duplicate tower rows ' + dup.join(', ')); process.exit(1); }
}
const tpl = read('src/index.html');
let rev = 'dev';
try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* not a repo */ }
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

const js = ['src/level.js', 'src/physics.js', 'src/game.js'].map((f) => `// ---- ${f}\n` + read(f)).join('\n');
const scripts = `<script>window.BUILD=${JSON.stringify(rev + ' ' + stamp)};\n${js.replace(/<\/script/g, '<\\/script')}</script>`;

const head = tpl.match(/<!--HEAD-->([\s\S]*?)<!--\/HEAD-->/)[1].trim();
const body = tpl.replace(/<!--HEAD-->[\s\S]*?<!--\/HEAD-->/, '').replace('<!--SCRIPTS-->', scripts).trim();

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/artifact.html', import.meta.url), head + '\n' + body + '\n');
writeFileSync(new URL('../dist/index.html', import.meta.url), `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
${head}
</head>
<body>
${body}
</body>
</html>
`);
console.log(`built dist/index.html + dist/artifact.html (${rev} ${stamp}, ${(scripts.length / 1024).toFixed(1)} KB js)`);
