const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.join(__dirname, '..', 'profile');
const EAC_URL = 'https://eac.zigbang.in/';

async function launch({ headless = true } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return context;
}

// EAC에 로그인된 상태인지 확인: eac.zigbang.in으로 이동했을 때
// Google 로그인 페이지로 튕기지 않으면 로그인된 것으로 판단
async function isLoggedIn(page) {
  await page.goto(EAC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  return !page.url().includes('accounts.google.com');
}

module.exports = { launch, isLoggedIn, EAC_URL, PROFILE_DIR };
