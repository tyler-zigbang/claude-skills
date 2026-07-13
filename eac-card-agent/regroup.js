// FI_12 임시전표 그룹 재구성: 기존 그룹 취소 → 전체를 한 그룹으로 (상신 안 함)
const { launch, openEAC, gotoMenu, clickSearch, gridData, checkRows } = require('./lib/eac');

async function dismissModals(page, maxRounds = 5) {
  for (let i = 0; i < maxRounds; i++) {
    await page.waitForTimeout(1500);
    const btn = page
      .locator('.ui-dialog:visible button, .unidocu-dialog:visible button, [class*="dialog"]:visible button')
      .filter({ hasText: /^(확인|예|OK)$/ })
      .first();
    if (await btn.isVisible().catch(() => false)) {
      const msg = await page.locator('.ui-dialog:visible, .unidocu-dialog:visible').first().innerText().catch(() => '');
      console.log('  [모달]', msg.replace(/\s+/g, ' ').slice(0, 120));
      await btn.click();
    } else return;
  }
}

(async () => {
  const context = await launch({ headless: true });
  const page = await openEAC(context);
  page.on('dialog', async (d) => {
    console.log('  [다이얼로그]', d.message().slice(0, 120));
    await d.accept();
  });

  await gotoMenu(page, '전자결재', 'EA전표결재');
  await clickSearch(page);
  let rows = await gridData(page);

  // 1) 기존 그룹 취소 (미상신 FI_12 중 그룹 있는 것)
  const grouped = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.EVIKB === 'FI_12' && r.GRONO && r.STATS_TXT !== '상신');
  if (grouped.length) {
    console.log(`그룹 취소 대상 ${grouped.length}건 (${grouped[0].r.GRONO})`);
    await checkRows(page, grouped.map((g) => g.i));
    await page.locator('#cancelGroup').click();
    await dismissModals(page);
    await page.waitForTimeout(8000);
    await dismissModals(page);
  } else {
    console.log('취소할 그룹 없음');
  }

  // 2) 전체 FI_12 미상신·미그룹을 한 그룹으로
  await clickSearch(page);
  rows = await gridData(page);
  const ungrouped = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.EVIKB === 'FI_12' && !r.GRONO && r.STATS_TXT !== '상신');
  console.log(`그룹 생성 대상 ${ungrouped.length}건`);
  if (!ungrouped.length) throw new Error('그룹 생성 대상 없음');
  await checkRows(page, ungrouped.map((g) => g.i));
  await page.locator('#makeGroup').click();
  await dismissModals(page);
  await page.waitForTimeout(8000);
  await dismissModals(page);

  // 3) 검증
  await clickSearch(page);
  rows = await gridData(page);
  const fi12 = rows.filter((r) => r.EVIKB === 'FI_12');
  console.log('\n최종 상태:');
  for (const r of fi12) console.log(`  ${r.BELNR} ${r.SGTXT} ${Number(r.WRBTR).toLocaleString()}원 그룹:${r.GRONO || '-'} 상태:${r.STATS_TXT || '미상신'}`);

  await context.close();
})().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
