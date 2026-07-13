// Interactive browser login.
//
//   npm run login
//
// Opens a real Chromium window at the Mizito login page. You type your phone
// number + password (and any SMS code) yourself — credentials never touch this
// code. Once the SPA stores a session token, we persist:
//   - auth/storageState.json  (full cookies + localStorage, for re-opening a browser)
//   - auth/session.json       (just the x-token the API client needs)
import { chromium } from 'playwright';
import { WEB_LOGIN_URL, STORAGE_STATE_PATH, AUTH_DIR } from '@mohsp-99/mizito';
import { tokenFromStorageState, saveSession } from '@mohsp-99/mizito';
import { ensureDir, writeJson, log, sleep } from '@mohsp-99/mizito';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to finish logging in

async function readToken(page) {
  return page.evaluate(() => {
    try {
      return localStorage.getItem('token') || sessionStorage.getItem('token') || null;
    } catch {
      return null;
    }
  });
}

async function main() {
  ensureDir(AUTH_DIR);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'fa-IR' });
  const page = await context.newPage();

  log.info('Opening login page — log in with your phone number + password in the browser window.');
  await page.goto(WEB_LOGIN_URL, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let token = null;
  while (Date.now() < deadline) {
    token = await readToken(page).catch(() => null);
    if (token) break;
    await sleep(1000);
  }

  if (!token) {
    log.err('Timed out waiting for login. Nothing saved.');
    await browser.close();
    process.exit(1);
  }

  // Give the SPA a moment to finish populating storage after auth.
  await sleep(1500);
  const storageState = await context.storageState();
  writeJson(STORAGE_STATE_PATH, storageState);

  const finalToken = tokenFromStorageState(storageState) || token;
  saveSession({ token: finalToken });

  log.ok('Login captured.');
  log.info(`  storageState -> ${STORAGE_STATE_PATH}`);
  log.info(`  token        -> auth/session.json`);
  log.info('You can close the browser window; it will close automatically.');
  await browser.close();
}

main().catch((err) => {
  log.err(err.stack || String(err));
  process.exit(1);
});
