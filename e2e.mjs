/**
 * E2E: the full ghost-text flow in a real browser against the built app.
 *  1. Create a project, paste notes, type a draft sentence, pause.
 *  2. Expect: completion request fired (network!), ghost text rendered,
 *     Tab accepts it, autosave PATCH hits the server, reload keeps the draft.
 * Run: node e2e.mjs (expects server on $BASE_URL, default http://localhost:4210)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4210';
const NOTES = `Stuxnet was discovered in June 2010 by Kaspersky Lab. It targeted Siemens PLCs in Iranian nuclear facilities and used four zero-day exploits.
The worm spread via USB flash drives, compromising air-gapped networks. It is widely considered the first cyberweapon.
WannaCry hit in May 2017 using EternalBlue, an NSA exploit leaked by Shadow Brokers, encrypting 200,000 systems in 150 countries.`;

const browser = await chromium.launch();
const page = await browser.newPage();
const net = [];
page.on('request', (r) => {
	if (r.url().includes('/api/')) net.push(`${r.method()} ${r.url().replace(BASE, '')}`);
});
page.on('console', (m) => {
	if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

// 1. Create project (auth is disabled in this env)
await page.goto(BASE + '/');
await page.fill('input[placeholder="New project name…"]', 'E2E Test Paper');
await page.click('button:has-text("Create")');
await page.waitForSelector('.monaco-editor', { timeout: 15000 });
console.log('✓ project created, editor mounted');

// 2. Paste notes into the left panel
await page.fill('textarea', NOTES);
console.log('✓ notes entered');
// wait out the 1s index debounce
await page.waitForTimeout(1800);

// 3. Type into Monaco (click editor, type at end)
await page.click('.monaco-editor');
await page.keyboard.type('Stuxnet was first discovered in ', { delay: 40 });
console.log('✓ draft typed, waiting for ghost text…');

// 4. Wait for a completion request + ghost text widget
let sawRequest = false;
for (let i = 0; i < 30; i++) {
	await page.waitForTimeout(500);
	if (net.some((n) => n.includes('/api/llm/completions'))) {
		sawRequest = true;
		break;
	}
}
console.log(sawRequest ? '✓ completion request fired (NETWORK!)' : '✗ NO completion request after 15s');

// ghost text = monaco inline suggestion widget
const ghost = await page
	.locator('.monaco-editor .suggest-widget, .monaco-editor .inline-suggestion, .view-lines .ghost-text')
	.count();
console.log(`ghost widget elements: ${ghost}`);

// check editor content for accepted text after Tab
await page.keyboard.press('Tab');
await page.waitForTimeout(1200);
const content = await page.evaluate(() => {
	const ta = document.querySelector('textarea.inputarea');
	return ta ? ta.value : '(no textarea)';
});

// autosave wait
await page.waitForTimeout(1500);
console.log('network calls:', JSON.stringify(net, null, 1));

// 5. Reload → project list still there? open it → draft persisted?
await page.reload();
await page.waitForSelector('text=E2E Test Paper', { timeout: 10000 });
await page.click('text=E2E Test Paper');
await page.waitForSelector('.monaco-editor', { timeout: 15000 });
await page.waitForTimeout(1000);
const draftAfter = await page.evaluate(() => document.querySelector('.view-lines')?.textContent ?? '');
console.log('✓ reloaded, project reopened');
console.log('draft visible after reload:', JSON.stringify(draftAfter.slice(0, 120)));

await browser.close();
console.log('E2E DONE');
