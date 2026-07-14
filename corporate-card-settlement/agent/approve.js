// EAC 결재 승인 봇 (스킬: eac-approval)
// 사용법:
//   node approve.js menus             # 좌측 메뉴 트리 덤프 (탐색용)
//   node approve.js scan              # 결재 대기 문서 목록 JSON (읽기 전용)
//   node approve.js open <WF_KEY>     # 문서 상세 덤프: 본문·결재선·전표·원품의 URL (읽기 전용)
//   node approve.js flex <URL>        # flex 원품의 내용 덤프 (읽기 전용, flex 세션 사용)
//   node approve.js approve <WF_KEY>  # 문서 승인 — approve-ready.flag 있어야 동작
//
// 구조 확정(2026-07-14 사내망 탐색): 대기함 메뉴/그리드 필드/문서 팝업/원품의 그리드 검증 완료.
// 승인 버튼 클릭 흐름은 대기 문서가 생겨야 최종 검증 가능 — 첫 실행은 로그·스크린샷 확인할 것.

const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const { openEAC, gotoMenu, clickSearch, gridData } = require('./lib/eac');

const TYLER_PERNR = 'ZB01096'; // 결재요청 메일 링크의 ID/PERNR 파라미터에서 확인 (2026-07-14)
const READY_FLAG = path.join(__dirname, 'approve-ready.flag');
const LOGS = path.join(__dirname, 'logs');
const VIEW_URL = (wfKey) =>
  `https://eac.zigbang.in/unidocu/view.do?programId=DRAFT_0011&ID=${TYLER_PERNR}&PERNR=${TYLER_PERNR}&BUKRS=K001&WF_KEY=${wfKey}&showAsPopup=true`;

// 대기함 그리드에서 스킬이 쓰는 필드만
const SCAN_FIELDS = ['WF_KEY', 'WF_KEY_TEXT', 'WF_TITLE', 'WF_AMOUNT', 'WF_ID_TXT', 'WF_DATE', 'EVIKB_TXT', 'WF_ATTACH_FLAG', 'WF_STATUS_TXT'];

function ensureLogs() { if (!fs.existsSync(LOGS)) fs.mkdirSync(LOGS); }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

async function readInbox(page) {
  await gotoMenu(page, '전자결재', '대기함');
  try { await clickSearch(page); } catch (e) { /* 조회 버튼 없으면 그대로 */ }
  const rows = await gridData(page).catch(() => []);
  return (rows || []).map((r) => Object.fromEntries(SCAN_FIELDS.map((f) => [f, r[f]])));
}

// 문서 페이지 상세 덤프: 본문 텍스트 + 승인계 버튼 + 원품의(첨부) 그리드
async function dumpDocPage(page) {
  const out = { url: page.url() };
  out.bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 8000);
  const allButtons = await page.evaluate(() =>
    [...document.querySelectorAll('button, input[type=button]')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.innerText || b.value || '').trim()).filter((t) => t && t.length < 20));
  out.approvalButtons = [...new Set(allButtons)].filter((t) => /승인|반려|전결|회수|의견|목록/.test(t));
  // 품의 첨부 그리드 (ITKD_TXT: 원품의/날인품의/기타 + flex URL) — unidocu-grid가 이 그리드임 (2026-07-14 확인)
  try {
    const g = await gridData(page);
    out.attachments = (g || []).filter((r) => r.URL || r.ITKD_TXT);
  } catch (e) { out.attachments = []; }
  return out;
}

async function openDoc(context, wfKey) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(VIEW_URL(wfKey), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  if (page.url().includes('accounts.google.com')) throw new Error('LOGIN_EXPIRED');
  return page;
}

async function cmdMenus() {
  const context = await launch({ headless: true });
  try {
    const page = await openEAC(context);
    const mains = await page.locator('.main-menu-text-wrapper').allInnerTexts();
    const tree = {};
    for (const m of mains.map((s) => s.trim())) {
      await page.locator('.main-menu-text-wrapper', { hasText: m }).first().click();
      await page.waitForTimeout(1200);
      tree[m] = (await page.locator('.leaf-menu-text-wrapper:visible').allInnerTexts()).map((s) => s.trim());
    }
    console.log(JSON.stringify(tree, null, 1));
  } finally { await context.close(); }
}

async function cmdScan() {
  const context = await launch({ headless: true });
  try {
    const page = await openEAC(context);
    const docs = await readInbox(page);
    console.log(JSON.stringify({ pending: docs.length, docs }, null, 1));
  } finally { await context.close(); }
}

async function cmdOpen(wfKey) {
  const context = await launch({ headless: true });
  try {
    const page = await openDoc(context, wfKey);
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
    // 문서 상세 패널은 DOM 뒤쪽에 붙음 → 뒷부분 위주로 자름 (앞은 문서함 목록 노이즈)
    const full = await page.evaluate(() => document.body.innerText);
    console.log(JSON.stringify({ url: page.url(), bodyText: full.slice(-12000) }, null, 1));
  } finally { await context.close(); }
}

async function cmdApprove(wfKey) {
  if (!fs.existsSync(READY_FLAG)) {
    console.log(JSON.stringify({
      error: 'NOT_READY',
      message: '승인 흐름 최종 검증 전. 검증 후 approve-ready.flag 파일을 만들어 활성화하세요.',
    }));
    process.exit(4);
  }
  ensureLogs();
  const ts = stamp();
  const context = await launch({ headless: true });
  try {
    const page = await openEAC(context);

    // 가드 1: 대기함에 실제로 있는 문서만 승인 (완료/타인 문서 오승인 방지)
    const inbox = await readInbox(page);
    const target = inbox.find((d) => d.WF_KEY === wfKey);
    if (!target) {
      console.log(JSON.stringify({ error: 'NOT_IN_INBOX', message: '대기함에 없는 문서 — 승인 중단', wfKey }));
      process.exit(6);
    }

    // 문서 열기
    const doc = await openDoc(context, wfKey);
    await doc.screenshot({ path: path.join(LOGS, `approve-${ts}-before.png`), fullPage: true }).catch(() => {});

    // 가드 2: 승인 버튼 존재 확인
    const btn = doc.locator('button:visible', { hasText: /^승인$/ }).first();
    if (!(await btn.count())) {
      const d = await dumpDocPage(doc);
      console.log(JSON.stringify({ error: 'APPROVE_BUTTON_NOT_FOUND', buttons: d.approvalButtons }));
      process.exit(5);
    }

    // 네이티브 confirm 대비
    doc.on('dialog', async (dlg) => {
      fs.appendFileSync(path.join(LOGS, `approve-${ts}.log`), `[native dialog] ${dlg.message()}\n`);
      await dlg.accept().catch(() => {});
    });

    await btn.click();

    // 모달 처리 루프: 확인/예 클릭, 오류 모달이면 중단 (submit.js 패턴)
    for (let i = 0; i < 6; i++) {
      await doc.waitForTimeout(2500);
      const modalText = await doc.evaluate(() => {
        const dlgs = [...document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="popup"]')]
          .filter((el) => el.offsetParent !== null && el.innerText.trim());
        return dlgs.length ? dlgs[dlgs.length - 1].innerText.trim().slice(0, 300) : null;
      }).catch(() => null);
      if (modalText) {
        fs.appendFileSync(path.join(LOGS, `approve-${ts}.log`), `[modal] ${modalText}\n`);
        if (/오류|에러|없습니다|입력|지정/.test(modalText) && !/하시겠습니까/.test(modalText)) {
          await doc.screenshot({ path: path.join(LOGS, `approve-${ts}-error.png`), fullPage: true }).catch(() => {});
          console.log(JSON.stringify({ error: 'UNEXPECTED_MODAL', modalText }));
          process.exit(7);
        }
        const ok = doc.locator('button:visible').filter({ hasText: /^(확인|예|OK|승인)$/ }).first();
        if (await ok.count()) { await ok.click(); continue; }
      }
      break;
    }
    await doc.waitForTimeout(4000);
    await doc.screenshot({ path: path.join(LOGS, `approve-${ts}-after.png`), fullPage: true }).catch(() => {});

    // 검증: 대기함 재조회 — 문서가 사라졌으면 승인 성공
    const page2 = await openEAC(context);
    const inbox2 = await readInbox(page2);
    const still = inbox2.find((d) => d.WF_KEY === wfKey);
    if (still) {
      console.log(JSON.stringify({ error: 'STILL_IN_INBOX', message: '승인 후에도 대기함에 남아있음 — 실패로 간주', wfKey }));
      process.exit(8);
    }
    console.log(JSON.stringify({ ok: true, wfKey, title: target.WF_TITLE, amount: target.WF_AMOUNT, screenshots: `logs/approve-${ts}-*.png` }, null, 1));
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
