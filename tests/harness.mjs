// Shared Puppeteer harness: static server for dist/, browser discovery, console capture.
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(here, '..', 'dist');
export const shots = path.join(here, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
export function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(root, url === '/' ? 'index.html' : url);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** Puppeteer's own Chrome where it exists (CI/x64); on linux-arm64 fall back to a local Chromium. */
function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { const p = puppeteer.executablePath(); if (p && fs.existsSync(p)) return p; } catch { /* not downloaded */ }
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux-arm64/chrome', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(pw, d, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (fs.existsSync(p)) return p;
  return undefined;
}

export async function launch() {
  return puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    protocolTimeout: 300000,
  });
}

export async function openPage(browser, url, { width = 1280, height = 720 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const logs = [], errors = [];
  page.on('console', (m) => { const t = m.text(); logs.push(`[${m.type()}] ${t}`); if (m.type() === 'error') errors.push(t); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(240000);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.CART && window.CART.ready, { timeout: 120000 });
  return { page, logs, errors };
}

let passed = 0, failed = 0;
export const failures = [];
export async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { failed++; failures.push(name); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function summary() { console.log(`\n${passed} passed, ${failed} failed`); return failed; }

export async function shot(page, file) {
  try { await page.evaluate(() => window.CART.render()); await page.screenshot({ path: path.join(shots, file) }); }
  catch (e) { console.log(`      (screenshot ${file} skipped: ${e.message.split('\n')[0]})`); }
}
