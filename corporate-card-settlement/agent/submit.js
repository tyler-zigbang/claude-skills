// EAC 법인카드 자동 상신 파이프라인
//
// 사용법:
//   node submit.js plan            — 미처리 내역 + 분류 결과만 출력 (아무것도 안 만듦)
//   node submit.js create [N]      — 미처리 내역 앞에서 N건 전표생성 (기본: 전부)
//   node submit.js approve --dry   — EA전표결재에서 그룹생성+결재팝업 열어 구조만 덤프 (팝업 닫으면 그룹 자동취소)
//   node submit.js approve         — 그룹생성 → 결재요청 → 최종 상신
//   node submit.js run             — create 전부 + approve (월간 자동 실행용)
const fs = require('fs');
const path = require('path');
const { launch, openEAC, gotoMenu, clickSearch, gridData, checkRows } = require('./lib/eac');
const { classify } = require('./lib/classify');

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log(...a);

// ---------- 공통 ----------
async function dismissModals(page, maxRounds = 5) {
  // unidocuConfirm/unidocuAlert 류 DOM 모달의 확인/예 버튼 클릭
  for (let i = 0; i < maxRounds; i++) {
    await page.waitForTimeout(1500);
    const btn = page
      .locator('.ui-dialog:visible button, .unidocu-dialog:visible button, [class*="dialog"]:visible button')
      .filter({ hasText: /^(확인|예|OK)$/ })
      .first();
    if (await btn.isVisible().catch(() => false)) {
      const msg = await page
        .locator('.ui-dialog:visible, .unidocu-dialog:visible')
        .first()
        .innerText()
        .catch(() => '');
      log('  [모달]', msg.replace(/\s+/g, ' ').slice(0, 120));
      await btn.click();
    } else return;
  }
}

// ---------- plan ----------
async function getPendingRows(page) {
  await gotoMenu(page, '비용정산', '법인카드');
  await clickSearch(page);
  return gridData(page);
}

function planRows(rows) {
  return rows.map((r) => {
    const c = classify(r);
    return {
      merch: r.MERCH_NAME,
      mcc: r.MCC_NAME,
      date: r.APPR_DATE,
      time: r.APPR_TIME,
      total: r.TOTAL,
      apprNo: r.APPR_NO,
      hkont: c.code,
      hkontName: c.name,
      sgtxt: c.sgtxt,
      uncertain: !!c.uncertain,
    };
  });
}

function splitByConfidence(rows) {
  const confident = [];
  const uncertain = [];
  for (const r of rows) (classify(r).uncertain ? uncertain : confident).push(r);
  return { confident, uncertain };
}

// ---------- create ----------
async function createOne(page, apprNo) {
  // 법인카드 목록에서 승인번호로 행 찾아 체크 → 전표작성 → 폼 채우고 전표생성
  await gotoMenu(page, '비용정산', '법인카드');
  await clickSearch(page);
  const rows = await gridData(page);
  const idx = rows.findIndex((r) => r.APPR_NO === apprNo);
  if (idx < 0) throw new Error(`승인번호 ${apprNo} 행 없음 (이미 처리됐을 수 있음)`);
  const row = rows[idx];
  const cls = classify(row);
  log(`- [${row.APPR_DATE} ${row.APPR_TIME}] ${row.MERCH_NAME} ${Number(row.TOTAL).toLocaleString()}원 → ${cls.code} ${cls.name} / "${cls.sgtxt}"`);

  await checkRows(page, [idx]);
  await page.locator('#createStatement').click();
  await page.waitForTimeout(8000);
  const hash = await page.evaluate(() => location.hash);
  if (!hash.includes('UD_0201_001')) throw new Error(`전표작성 폼 진입 실패 (hash=${hash})`);

  // 전기일: 증빙일(카드 승인일)과 동일 (2026-08-25 Tyler 지시. 기존 규칙 '실행 달의 1일'은 폐기)
  const budat = String(row.APPR_DATE);

  // 적요 + 계정코드 + 전기일 입력
  const fill = await page.evaluate(
    ({ sgtxt, hkont, budat }) => {
      return new Promise((resolve) => {
        window.require(['uni_realgrid/wrapper/realgridWrapper'], (w) => {
          try {
            const g = w.getGrid('unidocu-grid');
            // 헤더 적요
            const c = window.$u.get('SGTXT');
            c.setValue(sgtxt);
            c.$el.find('input').trigger('change');
            // 전기일 (지급예정일 재계산을 위해 change 트리거)
            const b = window.$u.get('BUDAT');
            b.setValue(budat);
            b.$el.find('input').trigger('change');
            // 계정코드 (시스템도 같은 방식 사용: UD_0201_001.js — $V 후 fillPopupText로 계정명 조회)
            g.$V('HKONT', 0, hkont);
            g.fillPopupText();
            // 그리드 적요도 직접 세팅 (헤더 change 전파 안 될 경우 대비)
            g.$V('SGTXT', 0, sgtxt);
            resolve({ ok: true });
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        });
      });
    },
    { sgtxt: cls.sgtxt, hkont: cls.code, budat }
  );
  if (!fill.ok) throw new Error('폼 입력 실패: ' + fill.error);
  await page.waitForTimeout(4000); // HKONT 서버 검증/TXT 조회 대기

  const verify = await page.evaluate(() => {
    return new Promise((resolve) => {
      window.require(['uni_realgrid/wrapper/realgridWrapper'], (w) => {
        const g = w.getGrid('unidocu-grid');
        resolve({
          HKONT: g.$V('HKONT', 0),
          HKONT_TXT: g.$V('HKONT_TXT', 0),
          SGTXT: g.$V('SGTXT', 0),
          headerSGTXT: window.$u.get('SGTXT').getValue(),
          MWSKZ: window.$u.get('MWSKZ').getValue(),
          BUDAT: window.$u.get('BUDAT').getValue(),
        });
      });
    });
  });
  log('  입력확인:', JSON.stringify(verify));
  if (verify.HKONT !== cls.code) throw new Error('계정코드 미반영');
  if (!verify.HKONT_TXT) throw new Error('계정명 조회 안 됨 (fillPopupText 실패) — 전표생성 중단');
  if (!verify.headerSGTXT) throw new Error('적요 미반영');
  if (verify.BUDAT !== budat) throw new Error(`전기일 미반영 (기대 ${budat}, 실제 ${verify.BUDAT})`);

  await page.screenshot({ path: path.join(OUT, `${stamp}-form-${apprNo}.png`) });

  // 전표생성 — 마감월 알림([ZUNIEFI_1009] "전기일을 익월 1일로 입력") 시 전기일을 익월 1일로 바꿔 재시도 (2026-09-23 추가)
  const nextMonthFirst = (yyyymmdd) => {
    const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6); // m = 1-based 월 → Date(y, m, 1)은 다음 달 1일
    const d = new Date(y, m, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`;
  };
  let belnr = null;
  let curBudat = budat;
  for (let attempt = 0; attempt < 3 && !belnr; attempt++) {
    await page.locator('#createStatement').click();
    let closedMonth = false;
    // 성공 모달("전표가 정상적으로 생성 되었습니다" + 전표번호) 대기
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000);
      const modal = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('div')].find(
          (e) => e.getBoundingClientRect().width > 0 && /전표가 정상적으로 생성/.test(e.innerText || '') && e.innerText.length < 500
        );
        return dlg ? dlg.innerText : null;
      });
      if (modal) {
        belnr = (modal.match(/32\d{8}/) || [null])[0];
        break;
      }
      // 알림 모달 문구 수집
      const alertTxt = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('.ui-dialog, .unidocu-dialog, [class*="dialog"]')].find(
          (e) => e.getBoundingClientRect().width > 0 && (e.innerText || '').trim()
        );
        return dlg ? dlg.innerText.replace(/\s+/g, ' ').slice(0, 200) : null;
      });
      if (alertTxt && /마감되었습니다/.test(alertTxt)) {
        closedMonth = true;
        log('  [마감월] ' + alertTxt);
        break;
      }
      if (alertTxt && /입력해 주세요|오류|실패/.test(alertTxt)) throw new Error('전표생성 검증 실패: ' + alertTxt.slice(0, 150));
      if (alertTxt) log('  [진단 모달] ' + alertTxt);
    }
    if (belnr || !closedMonth) break;
    // 마감월: 알림 닫고 전기일을 익월 1일로 변경 후 재시도
    await dismissModals(page, 2);
    curBudat = nextMonthFirst(curBudat);
    log(`  → 전기일을 ${curBudat}로 변경해 재시도`);
    const set = await page.evaluate((b) => {
      try {
        const c = window.$u.get('BUDAT');
        c.setValue(b);
        c.$el.find('input').trigger('change');
        return window.$u.get('BUDAT').getValue();
      } catch (e) {
        return 'ERR:' + e.message;
      }
    }, curBudat);
    if (set !== curBudat) throw new Error(`전기일 변경 실패 (${set})`);
    await page.waitForTimeout(3000);
  }
  if (!belnr) {
    await page.screenshot({ path: path.join(OUT, `${stamp}-fail-${apprNo}.png`), fullPage: true }).catch(() => {});
    throw new Error('전표생성 성공 모달을 확인하지 못함 (스크린샷: logs/' + stamp + '-fail-' + apprNo + '.png)');
  }
  log(`  ✔ 전표번호 ${belnr} 생성됨` + (curBudat !== budat ? ` (전기일 ${budat} → ${curBudat}, 마감월 조정)` : ''));
  await page.screenshot({ path: path.join(OUT, `${stamp}-created-${apprNo}.png`) });
  // "계속 작성" 클릭 → 다음 건 진행 가능 상태로
  const contBtn = page.locator('button').filter({ hasText: '계속 작성' }).first();
  if (await contBtn.isVisible().catch(() => false)) await contBtn.click();
  await page.waitForTimeout(4000);
  return { apprNo, cls, belnr };
}

// ---------- approve ----------
async function approve(page, context, { dry }) {
  await gotoMenu(page, '전자결재', 'EA전표결재');
  await clickSearch(page);
  let rows = await gridData(page);
  let targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.EVIKB === 'FI_12' && !r.GRONO && r.STATS_TXT !== '상신');
  log(`FI_12 미그룹 임시전표: ${targets.length}건`);
  if (!targets.length) {
    log('상신할 전표 없음');
    return;
  }
  for (const t of targets) log(`  - ${t.r.BELNR} ${t.r.SGTXT} ${Number(t.r.WRBTR).toLocaleString()}원`);

  // 그룹번호생성
  await checkRows(page, targets.map((t) => t.i));
  await page.locator('#makeGroup').click();
  await dismissModals(page); // 확인 confirm
  await page.waitForTimeout(8000);
  await dismissModals(page);

  // 재조회 후 그룹 잡힌 FI_12 행 다시 선택
  await clickSearch(page);
  rows = await gridData(page);
  const grouped = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.EVIKB === 'FI_12' && r.GRONO && r.STATS_TXT !== '상신');
  log(`그룹생성됨: ${grouped.length}건, GRONO=${grouped[0]?.r.GRONO}`);
  if (!grouped.length) throw new Error('그룹번호생성 실패');

  await checkRows(page, grouped.map((g) => g.i));
  const popupPromise = context.waitForEvent('page', { timeout: 30000 }).catch(() => null);
  await page.locator('#requestApproval').click();
  await dismissModals(page, 2);
  const popup = await popupPromise;
  if (!popup) throw new Error('결재요청 팝업이 열리지 않음');
  await popup.waitForTimeout(12000);
  await popup.screenshot({ path: path.join(OUT, `${stamp}-approval-popup.png`), fullPage: true }).catch(() => {});

  // 팝업 구조 덤프
  const pd = await popup.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0;
    return {
      url: location.href,
      buttons: [...document.querySelectorAll('button, input[type=button]')]
        .filter(vis)
        .map((e) => ({ text: (e.innerText || e.value || '').trim().slice(0, 25), id: e.id || undefined }))
        .filter((b) => b.text),
      inputs: [...document.querySelectorAll('input:not([type=hidden]), textarea')]
        .filter(vis)
        .slice(0, 30)
        .map((e) => ({ tag: e.tagName, id: e.id || undefined, name: e.name || undefined, val: (e.value || '').slice(0, 50) })),
      text: document.body.innerText.slice(0, 2500),
    };
  });
  fs.writeFileSync(path.join(OUT, `${stamp}-approval-popup.json`), JSON.stringify(pd, null, 1));
  log('팝업 URL:', pd.url);
  log('팝업 버튼:', JSON.stringify(pd.buttons));

  if (dry) {
    log('[dry] 팝업 닫음 (useCancelGroupOnApprovalPopupClose=true → 그룹 자동취소)');
    await popup.close();
    return;
  }

  // 제목: 팝업이 자동 생성함 ("스마트홈 중식 외 6건"). 비어있을 때만 채움.
  const titleInfo = await popup.evaluate((fallback) => {
    const el = document.querySelector('input[name="WF_TITLE"]');
    if (!el) return { ok: false };
    if (!el.value.trim()) {
      el.value = fallback;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, title: el.value };
  }, grouped.length > 1 ? `${grouped[0].r.SGTXT} 외${grouped.length - 1}건` : grouped[0].r.SGTXT);
  if (!titleInfo.ok) {
    await popup.close();
    throw new Error('WF_TITLE 입력란 없음 — 팝업 구조 변경 의심, 중단(그룹 자동취소)');
  }
  log('제목:', titleInfo.title);

  // 결재라인 옵션 로깅 (기본 결재선은 서버가 적용)
  const lineOpts = await popup.evaluate(() =>
    [...document.querySelectorAll('select')].slice(0, 3).map((s) => ({
      options: [...s.options].map((o) => o.text).slice(0, 10),
      selected: s.selectedIndex >= 0 ? s.options[s.selectedIndex]?.text : null,
    }))
  );
  log('결재라인 콤보:', JSON.stringify(lineOpts));

  // 결재요청 클릭
  popup.on('dialog', async (d) => {
    log('  [팝업 다이얼로그]', d.message());
    await d.accept();
  });
  await popup.locator('#requestApproval').first().click();
  // 모달 처리: confirm(하시겠습니까→확인), 에러(입력/지정/오류→중단)
  let submitted = false;
  for (let i = 0; i < 10; i++) {
    await popup.waitForTimeout(2500);
    if (popup.isClosed()) {
      submitted = true;
      break;
    }
    const modal = await popup
      .evaluate(() => {
        const dlgs = [...document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="popup"]')].filter(
          (e) => e.getBoundingClientRect().width > 0 && (e.innerText || '').trim() && e.innerText.length < 600
        );
        return dlgs.length ? dlgs[dlgs.length - 1].innerText.replace(/\s+/g, ' ').slice(0, 200) : null;
      })
      .catch(() => null);
    if (modal) {
      log('  [팝업 모달]', modal);
      if (/입력해 주세요|지정|선택해 주세요|오류|실패|없습니다/.test(modal)) {
        await popup.screenshot({ path: path.join(OUT, `${stamp}-approval-error.png`) }).catch(() => {});
        await popup.close();
        throw new Error('상신 실패 모달: ' + modal);
      }
      const ok = popup.locator('button:visible').filter({ hasText: /^(확인|예|OK)$/ }).first();
      if (await ok.isVisible().catch(() => false)) await ok.click();
      if (/상신|완료|요청 되었/.test(modal)) submitted = true;
    }
  }
  await page.waitForTimeout(5000);
  log(submitted ? '상신 완료 (제목: ' + titleInfo.title + ')' : '상신 여부 불확실 — 아래 재조회로 검증');

  // 검증: 재조회해서 상태 확인
  await clickSearch(page);
  const finalRows = await gridData(page);
  const nowSubmitted = finalRows.filter((r) => r.EVIKB === 'FI_12' && r.STATS_TXT === '상신');
  log(`상신 상태 FI_12 전표: ${nowSubmitted.length}건`);
}

// ---------- main ----------
(async () => {
  const mode = process.argv[2] || 'plan';
  const dry = process.argv.includes('--dry');
  const context = await launch({ headless: true });
  const page = await openEAC(context);
  page.on('dialog', async (d) => {
    log('  [다이얼로그]', d.message().slice(0, 150));
    await d.accept();
  });

  try {
    if (mode === 'plan') {
      const rows = await getPendingRows(page);
      const plan = planRows(rows);
      log(`\n미처리 카드내역 ${plan.length}건:`);
      for (const p of plan) {
        log(
          `  [${p.date} ${p.time}] ${p.merch} (${p.mcc}) ${Number(p.total).toLocaleString()}원 → ${p.hkont} ${p.hkontName} / "${p.sgtxt}"${p.uncertain ? ' (추정)' : ''}`
        );
      }
      fs.writeFileSync(path.join(OUT, `${stamp}-plan.json`), JSON.stringify(plan, null, 1));
    } else if (mode === 'create') {
      const limit = parseInt(process.argv[3] || '999', 10);
      const rows = await getPendingRows(page);
      const { confident, uncertain } = splitByConfidence(rows);
      const targets = confident.slice(0, limit);
      log(`전표생성 대상: ${targets.length}건 (분류불가 제외: ${uncertain.length}건)`);
      for (const r of uncertain) log(`  [제외] ${r.MERCH_NAME} (${r.MCC_NAME}) ${Number(r.TOTAL).toLocaleString()}원 — 분류 불가, 수동 처리 필요`);
      for (const r of targets) await createOne(page, r.APPR_NO);
      log('전표생성 완료');
    } else if (mode === 'approve') {
      await approve(page, context, { dry });
    } else if (mode === 'run') {
      // 월간 자동 실행: 전표생성까지만. 최종 상신은 Tyler가 EAC에서 직접
      // (EA전표결재 → 전체선택 → 그룹번호생성 → 결재요청 → 결재요청 버튼).
      const rows = await getPendingRows(page);
      const { confident, uncertain } = splitByConfidence(rows);
      log(`미처리 ${rows.length}건 중 ${confident.length}건 전표생성 시작 (분류불가 ${uncertain.length}건 제외)`);
      for (const r of uncertain) log(`  [제외] ${r.MERCH_NAME} (${r.MCC_NAME}) ${Number(r.TOTAL).toLocaleString()}원 — 분류 불가, 수동 처리 필요`);
      for (const r of confident) await createOne(page, r.APPR_NO);
      log('\n전표생성 완료 — 상신은 EAC에서 직접 진행해 주세요 (EA전표결재 화면).');
    } else {
      log('알 수 없는 모드:', mode);
    }
  } finally {
    await context.close();
  }
})().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
