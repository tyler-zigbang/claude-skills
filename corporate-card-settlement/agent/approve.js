// EAC 결재 승인 봇 (스킬: eac-approval)
// 사용법:
//   node approve.js menus             # 좌측 메뉴 트리 덤프 (탐색용)
//   node approve.js scan              # 결재 대기 문서 목록+상세 JSON (읽기 전용)
//   node approve.js open <WF_KEY>     # 문서 팝업 상세 덤프 (읽기 전용)
//   node approve.js flex <URL>        # flex 원품의 내용 덤프 (읽기 전용, flex 세션 사용)
//   node approve.js approve <WF_KEY>  # 문서 승인 — approve-ready.flag 있어야 동작
//
// ⚠️ 미탐색 상태 초안: scan의 메뉴명과 approve의 버튼은 사내망에서 탐색 후 확정 필요.
//    확정 전까지 approve는 approve-ready.flag가 없으면 거부한다.

const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const { openEAC, gotoMenu, clickSearch, gridData } = require('./lib/eac');

const TYLER_PERNR = 'ZB01096'; // 결재요청 메일 링크의 ID/PERNR 파라미터에서 확인 (2026-07-14)
const READY_FLAG = path.join(__dirname, 'approve-ready.flag');
const VIEW_URL = (wfKey) =>
  `https://eac.zigbang.in/unidocu/view.do?programId=DRAFT_0011&ID=${TYLER_PERNR}&PERNR=${TYLER_PERNR}&BUKRS=K001&WF_KEY=${wfKey}&showAsPopup=true`;

// 결재 대기함 leaf 메뉴 후보 (탐색 후 확정되면 첫 항목으로 고정할 것)
const INBOX_LEAF_CANDIDATES = ['미결함', '결재대기함', '결재함', '승인대기', '결재할 문서', '미결'];

async function dumpMenus(page) {
  const mains = await page.locator('.main-menu-text-wrapper').allInnerTexts();
  const tree = {};
  for (const m of mains) {
    try {
      await page.locator('.main-menu-text-wrapper', { hasText: m }).first().click();
      await page.waitForTimeout(1200);
      tree[m] = await page.locator('.leaf-menu-text-wrapper:visible').allInnerTexts();
    } catch (e) {
      tree[m] = ['(error: ' + e.message + ')'];
    }
  }
  return tree;
}

async function gotoInbox(page) {
  for (const leaf of INBOX_LEAF_CANDIDATES) {
    try {
      await gotoMenu(page, '전자결재', leaf);
      return leaf;
    } catch (e) { /* 다음 후보 */ }
  }
  return null;
}

// 페이지(또는 팝업)의 문서 내용 덤프: 텍스트, 버튼, flex 링크, 그리드
async function dumpDocPage(page) {
  const out = { url: page.url() };
  out.bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 6000);
  out.buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button, input[type=button], a.btn, [class*="button"]')]
      .map((b) => (b.innerText || b.value || '').trim()).filter((t) => t && t.length < 30)
      .filter((t, i, a) => a.indexOf(t) === i));
  out.flexLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.includes('flex.team'))
      .filter((h, i, a) => a.indexOf(h) === i));
  // iframe 내부도 (UniDocu는 iframe 사용이 잦음)
  out.frames = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const t = await f.evaluate(() => document.body.innerText);
      const links = await f.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.includes('flex.team')));
      out.frames.push({ url: f.url(), text: t.slice(0, 4000), flexLinks: links });
    } catch (e) { /* cross-origin 등 */ }
  }
  try { out.grid = await gridData(page); } catch (e) { /* 그리드 없음 */ }
  return out;
}

async function cmdMenus() {
  const context = await launch({ headless: true });
  try {
    const page = await openEAC(context);
    console.log(JSON.stringify(await dumpMenus(page), null, 1));
  } finally { await context.close(); }
}

async function cmdScan() {
  const context = await launch({ headless: true });
  try {
    const page = await openEAC(context);
    const leaf = await gotoInbox(page);
    if (!leaf) {
      console.log(JSON.stringify({ error: 'INBOX_MENU_NOT_FOUND', menus: await dumpMenus(page) }, null, 1));
      process.exit(2);
    }
    try { await clickSearch(page); } catch (e) { /* 조회 버튼 없으면 그대로 */ }
    const rows = await gridData(page).catch(() => null);
    console.log(JSON.stringify({ inboxMenu: leaf, rows }, null, 1));
  } finally { await context.close(); }
}

async function cmdOpen(wfKey) {
  const context = await launch({ headless: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(VIEW_URL(wfKey), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    if (page.url().includes('accounts.google.com')) throw new Error('LOGIN_EXPIRED');
    console.log(JSON.stringify(await dumpDocPage(page), null, 1));
  } finally { await context.close(); }
}

// flex 원품의 열람 — flex-fitness-agent의 프로필/쿠키 재사용 (읽기 전용)
async function cmdFlex(url) {
  const FLEX_AGENT = path.join(process.env.USERPROFILE, 'flex-fitness-agent');
  const { chromium } = require('playwright');
  const context = await chromium.launchPersistentContext(path.join(FLEX_AGENT, 'profile'), {
    channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    const cookieFile = path.join(FLEX_AGENT, 'out', 'flex-cookies.json');
    if (fs.existsSync(cookieFile)) {
      try { await context.addCookies(JSON.parse(fs.readFileSync(cookieFile, 'utf8'))); } catch (e) {}
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    if (page.url().includes('/auth')) {
      console.log(JSON.stringify({ error: 'FLEX_LOGIN_EXPIRED', hint: 'cd ~/flex-fitness-agent && node login.js' }));
      process.exit(3);
    }
    const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 8000);
    // 금액 후보: "1,234,567원" 패턴 전부
    const amounts = [...bodyText.matchAll(/[\d,]{4,}\s*원/g)].map((m) => m[0]).slice(0, 20);
    console.log(JSON.stringify({ url: page.url(), amounts, bodyText }, null, 1));
  } finally { await context.close(); }
}

async function cmdApprove(wfKey) {
  if (!fs.existsSync(READY_FLAG)) {
    console.log(JSON.stringify({
      error: 'NOT_READY',
      message: '승인 버튼 흐름이 아직 실기기에서 검증되지 않았습니다. 사내망에서 탐색·검증 후 approve-ready.flag 파일을 만들어 활성화하세요.',
    }));
    process.exit(4);
  }
  const context = await launch({ headless: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(VIEW_URL(wfKey), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    if (page.url().includes('accounts.google.com')) throw new Error('LOGIN_EXPIRED');

    // ===== 탐색 후 확정 필요 구간 =====
    // 후보: 상단 툴바의 "승인" 버튼 → 확인 팝업 "확인"/"승인" 클릭
    // UniDocu는 $ewf API가 있을 수 있음: page.evaluate(() => $ewf.approve(...)) 형태도 탐색할 것
    const before = await dumpDocPage(page);
    const btn = page.locator('button:visible, input[type=button]:visible', { hasText: '승인' }).first();
    if (!(await btn.count())) {
      console.log(JSON.stringify({ error: 'APPROVE_BUTTON_NOT_FOUND', page: before.buttons }));
      process.exit(5);
    }
    await btn.click();
    await page.waitForTimeout(3000);
    // 확인 팝업 처리 (있으면)
    for (const label of ['확인', '승인', '예']) {
      const c = page.locator(`button:visible:has-text("${label}")`).first();
      if (await c.count()) { await c.click(); await page.waitForTimeout(3000); break; }
    }
    const after = (await page.evaluate(() => document.body.innerText)).slice(0, 2000);
    console.log(JSON.stringify({ ok: true, wfKey, afterText: after }, null, 1));
  } finally { await context.close(); }
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'menus') return cmdMenus();
  if (cmd === 'scan') return cmdScan();
  if (cmd === 'open' && arg) return cmdOpen(arg);
  if (cmd === 'flex' && arg) return cmdFlex(arg);
  if (cmd === 'approve' && arg) return cmdApprove(arg);
  console.log('사용법: node approve.js menus|scan|open <WF_KEY>|flex <URL>|approve <WF_KEY>');
  process.exit(1);
})().catch((e) => {
  const msg = e.message.includes('ERR_NAME_NOT_RESOLVED') ? 'EAC_UNREACHABLE(사내망 아님)' : e.message;
  console.error(JSON.stringify({ error: 'FATAL', message: msg }));
  process.exit(1);
});
