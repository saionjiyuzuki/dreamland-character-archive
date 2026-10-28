import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('compiled legacyGame imports ALLOWED_TRANSITIONS', async () => {
  const code = await readFile(new URL('../dist/legacyGame.js', import.meta.url), 'utf8');
  assert.match(code, /import\s*\{[^}]*\bALLOWED_TRANSITIONS\b[^}]*\}\s*from\s*['"]\.\/state\/stateMachine\.js['"]/s);
});

test('compiled main is emitted from src/main.ts, not stale App bootstrap', async () => {
  const code = await readFile(new URL('../dist/main.js', import.meta.url), 'utf8');
  assert.match(code, /import\s*\{\s*boot\s*\}\s*from\s*['"]\.\/legacyGame\.js['"]/);
  assert.match(code, /boot\(\)/);
  assert.doesNotMatch(code, /new App\(/);
  await assert.rejects(access(new URL('../dist/app/app.js', import.meta.url)), 'stale dist/app/app.js should have been removed');
});

test('start.command rebuilds before serving', async () => {
  const code = await readFile(new URL('../start.command', import.meta.url), 'utf8');
  assert.ok(code.indexOf('npm run build') >= 0);
  assert.ok(code.indexOf('npm run build') < code.indexOf('python3 "$ROOT/scripts/serve.py"'));
});

test('visible app version is V12.10.0', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /DREAMLAND[^<]*V12\.10\.0/i);
});

test('V-PASS is rendered by the economy service, not patched by a DOM observer', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /vpassEnhanced|MutationObserver/);
});

test('all CSS rules live inside <style>, not as stray text in <head>', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const stray = head
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  assert.equal(stray, '', 'text outside <style> would render as visible page text');
});

test('pass and shop are standalone pages, not a modal inside song select', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="pagePass"/);
  assert.match(html, /id="pageShop"/);
  assert.doesNotMatch(html, /economyModal|difficultySlider/);
  const select = html.slice(html.indexOf('id="pageSongSelect"'), html.indexOf('id="pageCharacter"'));
  assert.doesNotMatch(select, /data-economy-open="shop"|data-buy-song/);
});
