// 전기일(BUDAT) 설정 검증: 폼 열어 입력만 하고 전표생성 없이 종료
const path = require('path');
const { launch, openEAC, gotoMenu, clickSearch, gridData, checkRows } = require('./lib/eac');

(async () => {
  const context = await launch({ headless: true });
  const page = await openEAC(context);
  page.on('dialog', async (d) => d.accept());

  await gotoMenu(page, '비용정산', '법인카드');
  await clickSearch(page);
  const rows = await gridData(page);
  if (!rows.length) {
    console.log('미처리 내역 없음 — 테스트 불가');
    await context.close();
    return;
  }
  console.log('테스트 대상:', rows[0].MERCH_NAME, rows[0].APPR_DATE);
  await checkRows(page, [0]);
  await page.locator('#createStatement').click();
  await page.waitForTimeout(8000);
  console.log('hash:', await page.evaluate(() => location.hash));

  const before = await page.evaluate(() => ({
    BUDAT: window.$u.get('BUDAT').getValue(),
    ZFBDT: window.$u.get('ZFBDT') ? window.$u.get('ZFBDT').getValue() : null,
  }));
  console.log('설정 전:', JSON.stringify(before));

  const res = await page.evaluate((budat) => {
    try {
      const b = window.$u.get('BUDAT');
      b.setValue(budat);
      b.$el.find('input').trigger('change');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, '20260701');
  console.log('setValue:', JSON.stringify(res));
  await page.waitForTimeout(4000);

  const after = await page.evaluate(() => ({
    BUDAT: window.$u.get('BUDAT').getValue(),
    ZFBDT: window.$u.get('ZFBDT') ? window.$u.get('ZFBDT').getValue() : null,
  }));
  console.log('설정 후:', JSON.stringify(after));
  await page.screenshot({ path: path.join(__dirname, 'logs', 'test-budat.png') });
  console.log('전표생성 없이 종료');
  await context.close();
})().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
