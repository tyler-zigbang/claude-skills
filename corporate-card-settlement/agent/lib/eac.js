// EAC 공용 헬퍼: 메뉴 이동, 그리드 접근
const { launch, EAC_URL } = require('./browser');

async function openEAC(context) {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(EAC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  if (page.url().includes('accounts.google.com')) throw new Error('LOGIN_EXPIRED');
  return page;
}

// 좌측 메뉴 이동: gotoMenu(page, '비용정산', '법인카드')
// 이미 펼쳐져 있으면 바로 leaf 클릭, 아니면 main 먼저 클릭해서 펼침
async function gotoMenu(page, main, leaf) {
  async function tryClickLeaf() {
    const leafs = page.locator('.leaf-menu-text-wrapper');
    const n = await leafs.count();
    for (let i = 0; i < n; i++) {
      const el = leafs.nth(i);
      if ((await el.innerText()).trim() === leaf && (await el.isVisible())) {
        await el.click();
        await page.waitForTimeout(6000);
        return true;
      }
    }
    return false;
  }
  if (await tryClickLeaf()) return;
  await page.locator('.main-menu-text-wrapper', { hasText: main }).first().click();
  await page.waitForTimeout(1500);
  if (await tryClickLeaf()) return;
  throw new Error(`메뉴 없음: ${main} > ${leaf}`);
}

// 조회 버튼 클릭 후 대기
async function clickSearch(page, waitMs = 8000) {
  await page.locator('button.panel-search-button').first().click();
  await page.waitForTimeout(waitMs);
}

// 그리드 전체 데이터 읽기
async function gridData(page) {
  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      window.require(['uni_realgrid/wrapper/realgridWrapper'], (w) => {
        try {
          resolve(w.getGrid('unidocu-grid').getJSONData());
        } catch (e) {
          reject(new Error(e.message));
        }
      });
    });
  });
}

// 그리드 행 체크 (rowIndexes 배열)
async function checkRows(page, rowIndexes) {
  return page.evaluate((idxs) => {
    return new Promise((resolve) => {
      window.require(['uni_realgrid/wrapper/realgridWrapper'], (w) => {
        const g = w.getGrid('unidocu-grid');
        for (const i of idxs) g.$V('SELECTED', i, '1');
        resolve(g.getSELECTEDJSONData().length);
      });
    });
  }, rowIndexes);
}

module.exports = { launch, openEAC, gotoMenu, clickSearch, gridData, checkRows, EAC_URL };
