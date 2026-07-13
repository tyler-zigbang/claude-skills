// 현재 상태 확인 (읽기 전용): 미처리 카드내역 + EA전표결재 임시전표
const { launch, openEAC, gotoMenu, clickSearch, gridData } = require('./lib/eac');

(async () => {
  const context = await launch({ headless: true });
  const page = await openEAC(context);
  page.on('dialog', async (d) => d.accept());

  await gotoMenu(page, '비용정산', '법인카드');
  await clickSearch(page);
  const cards = await gridData(page);
  console.log(`\n[법인카드 미처리] ${cards.length}건`);
  for (const r of cards) console.log(`  ${r.APPR_DATE} ${r.MERCH_NAME} (${r.MCC_NAME}) ${Number(r.TOTAL).toLocaleString()}원`);

  await gotoMenu(page, '전자결재', 'EA전표결재');
  await clickSearch(page);
  const stmts = await gridData(page);
  const fi12 = stmts.filter((r) => r.EVIKB === 'FI_12');
  console.log(`\n[EA전표결재 임시전표] 전체 ${stmts.length}건, 법인카드(FI_12) ${fi12.length}건`);
  for (const r of fi12)
    console.log(`  ${r.BELNR} ${r.SGTXT} ${Number(r.WRBTR).toLocaleString()}원 그룹:${r.GRONO || '-'} 상태:${r.STATS_TXT || '미상신'}`);

  await context.close();
})().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
