// 임시전표 삭제: node delete-slips.js 3200012293-3200012321 (범위) 또는 번호 나열
const { launch, openEAC, gotoMenu, clickSearch, gridData, checkRows } = require('./lib/eac');

async function dismissModals(page, maxRounds = 6) {
  for (let i = 0; i < maxRounds; i++) {
    await page.waitForTimeout(1500);
    const btn = page
      .locator('.ui-dialog:visible button, .unidocu-dialog:visible button, [class*="dialog"]:visible button')
      .filter({ hasText: /^(확인|예|OK)$/ })
      .first();
    if (await btn.isVisible().catch(() => false)) {
      const msg = await page.locator('.ui-dialog:visible, .unidocu-dialog:visible').first().innerText().catch(() => '');
      console.log('  [모달]', msg.replace(/\s+/g, ' ').slice(0, 150));
      await btn.click();
    } else return;
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('삭제할 전표번호(또는 범위 A-B)를 지정하세요'); process.exit(1); }
  const wanted = new Set();
  for (const a of args) {
    const m = a.match(/^(\d{10})-(\d{10})$/);
    if (m) { for (let n = +m[1]; n <= +m[2]; n++) wanted.add(String(n)); }
    else wanted.add(a);
  }

  const context = await launch({ headless: true });
  const page = await openEAC(context);
  page.on('dialog', async (d) => { console.log('  [다이얼로그]', d.message().slice(0, 150)); await d.accept(); });

  await gotoMenu(page, '전자결재', 'EA전표결재');
  await clickSearch(page);
  let rows = await gridData(page);
  const targets = rows.map((r, i) => ({ r, i }))
    .filter(({ r }) => wanted.has(r.BELNR) && r.EVIKB === 'FI_12' && !r.GRONO && r.STATS_TXT !== '상신');
  console.log(`삭제 대상 ${targets.length}건 (요청 ${wanted.size}건)`);
  for (const t of targets) console.log(`  - ${t.r.BELNR} ${t.r.SGTXT} ${Number(t.r.WRBTR).toLocaleString()}원`);
  if (targets.length !== wanted.size) {
    const found = new Set(targets.map((t) => t.r.BELNR));
    for (const w of wanted) if (!found.has(w)) console.log(`  [없음/조건불일치] ${w}`);
  }
  if (!targets.length) { console.log('삭제할 전표 없음'); await context.close(); return; }

  await checkRows(page, targets.map((t) => t.i));
  await page.locator('#multiDeleteStatement').click();
  await dismissModals(page);
  await page.waitForTimeout(10000);
  await dismissModals(page);

  // 검증
  await clickSearch(page);
  rows = await gridData(page);
  const remain = rows.filter((r) => wanted.has(r.BELNR));
  console.log(remain.length ? `⚠ 아직 남아있음 ${remain.length}건: ${remain.map((r) => r.BELNR).join(',')}` : '✔ 전부 삭제 확인됨');
  await context.close();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
