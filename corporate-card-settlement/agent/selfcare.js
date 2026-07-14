// EAC 자기관리비(장려지원금 FI_21) 전표 자동생성 봇 — 상신 직전까지만 (상신은 Tyler 수동)
//
// 사용법:
//   node selfcare.js plan          — selfcare-items.json 검증 + 생성될 전표 미리보기 (읽기 전용)
//   node selfcare.js dry           — 첫 항목으로 폼 채우기까지만 (전표생성 버튼 안 누름, 스크린샷 저장)
//   node selfcare.js run           — selfcare-items.json 전 항목 전표생성 (상신 안 함)
//
// 입력 파일: selfcare-items.json
//   [{ "date": "20260620", "desc": "자기관리비(미용)", "account": "52010108", "amount": 49000, "file": "inbox/slip.png" }, ...]
//   account: 52010108 자기관리비 | 52010109 가족식사비
//   file: 증빙 (삼성카드 매출전표 캡처). FI_21은 첨부 없이도 통과된 선례가 있어 선택사항이지만 첨부 권장.
//
// 과거 상신 패턴 (Zigbang-회계전표-2026-0000022872 "자기관리비(미용)"에서 학습):
//   메뉴 = 비용정산 > 장려지원금 (FI_21). 화면 구조는 일반경비(FI_22)와 동일.
//   전표유형 KE, 사업영역 K200, 조정계정 21020103(미지급금-종업원, ZB00896 정진우),
//   세금 T0, 지급방법 R(실시간이체), 지급조건 V123(익월 23일), CC 226020(Device Engineering),
//   증빙일(BLDAT) = 지출일, 전기일(BUDAT) = 폼 기본값(오늘), 경비 1건 = 전표 1개, 헤더적요 = 라인적요 = desc
const fs = require('fs');
const path = require('path');
const { launch, openEAC, gotoMenu } = require('./lib/eac');

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log(...a);

const ACCOUNTS = {
  '52010108': '판)복리후생비-자기관리비',
  '52010109': '판)복리후생비-가족식사비',
};

function loadItems() {
  const p = path.join(__dirname, 'selfcare-items.json');
  if (!fs.existsSync(p)) throw new Error('selfcare-items.json 없음 — 경비 항목 파일을 먼저 작성하세요');
  const items = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(items) || !items.length) throw new Error('selfcare-items.json이 비어 있음');
  for (const [i, it] of items.entries()) {
    if (!/^\d{8}$/.test(it.date || '')) throw new Error(`items[${i}].date는 YYYYMMDD 형식이어야 함: ${it.date}`);
    if (!ACCOUNTS[it.account]) throw new Error(`items[${i}].account 미지원 계정: ${it.account} (52010108 자기관리비 | 52010109 가족식사비)`);
    if (!it.desc || !it.desc.trim()) throw new Error(`items[${i}].desc 비어 있음`);
    if (!Number.isFinite(it.amount) || it.amount <= 0) throw new Error(`items[${i}].amount가 양수가 아님: ${it.amount}`);
    if (it.file) {
      it.file = path.resolve(__dirname, it.file);
      if (!fs.existsSync(it.file)) throw new Error(`items[${i}].file 파일 없음: ${it.file}`);
    }
  }
  return items;
}

function printPlan(items) {
  let total = 0;
  log(`\n자기관리비(장려지원금) 전표 생성 계획 ${items.length}건:`);
  for (const it of items) {
    total += it.amount;
    log(`  [증빙일 ${it.date}] ${it.desc} — ${it.amount.toLocaleString()}원 → ${it.account} ${ACCOUNTS[it.account]}${it.file ? '' : ' (증빙 미첨부)'}`);
  }
  log(`  합계: ${total.toLocaleString()}원`);
  log('  (전표유형 KE / 사업영역 K200 / 세금 T0 / 지급방법 R / 지급조건 V123 / CC 226020 / 조정계정 21020103-정진우)');
}

// 장려지원금 화면에서 폼 채우기 (전표생성 버튼은 안 누름) — 일반경비와 동일 구조
async function fillForm(page, item) {
  const fill = await page.evaluate(({ bldat, sgtxt, hkont, amount }) => {
    return new Promise((resolve) => {
      window.require(['uni_realgrid/wrapper/realgridWrapper'], (w) => {
        try {
          const g = w.getGrid('unidocu-grid');
          const set = (name, val) => {
            const c = window.$u.get(name);
            if (!c) return false;
            c.setValue(val);
            try { c.$el.find('input').trigger('change'); } catch (e) {}
            try { c.$el.find('select').trigger('change'); } catch (e) {}
            return true;
          };
          // 증빙일 = 지출일 (지급예정일은 지급조건 V123이 자동 계산)
          set('BLDAT', bldat);
          // 헤더 적요
          set('SGTXT', sgtxt);
          // 그리드 라인: 계정코드 → fillPopupText(계정명 조회·검증), 금액, 적요
          g.$V('HKONT', 0, hkont);
          g.fillPopupText();
          g.$V('WRBTR', 0, String(amount));
          g.$V('SGTXT', 0, sgtxt);
          // 지급금액 (필수) — fillPopupText가 헤더 금액을 리셋하므로 그리드 입력 후 마지막에 세팅
          setTimeout(() => {
            const c = window.$u.get('WRBTR');
            c.setValue(String(amount));
            try { c.triggerChange(); } catch (e) {}
            resolve({ ok: true });
          }, 2500);
          return;
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
  }, { bldat: item.date, sgtxt: item.desc, hkont: item.account, amount: item.amount });
  if (!fill.ok) throw new Error('폼 입력 실패: ' + fill.error);
  await page.waitForTimeout(4000); // HKONT 서버 검증/계정명 조회 대기

  const v = await page.evaluate(() => {
    return new Promise((resolve) => {
      window.require(['uni_realgrid/wrapper/realgridWrapper'], (w) => {
        const g = w.getGrid('unidocu-grid');
        const gv = (n) => { try { return window.$u.get(n) ? window.$u.get(n).getValue() : null; } catch (e) { return null; } };
        resolve({
          BLDAT: gv('BLDAT'), BUDAT: gv('BUDAT'), BLART: gv('BLART'), GSBER: gv('GSBER'),
          ZLSCH: gv('ZLSCH'), ZTERM: gv('ZTERM'), LIFNR: gv('LIFNR'),
          headerSGTXT: gv('SGTXT'), headerWRBTR: gv('WRBTR'),
          HKONT: g.$V('HKONT', 0), HKONT_TXT: g.$V('HKONT_TXT', 0),
          WRBTR: g.$V('WRBTR', 0), SGTXT: g.$V('SGTXT', 0),
          KOSTL: g.$V('KOSTL', 0), MWSKZ: g.$V('MWSKZ', 0),
        });
      });
    });
  });
  log('  입력확인:', JSON.stringify(v));
  if (v.HKONT !== item.account) throw new Error('계정코드 미반영');
  if (!v.HKONT_TXT) throw new Error('계정명 조회 안 됨 (fillPopupText 실패)');
  if (String(v.WRBTR).replace(/[,\s]/g, '') !== String(item.amount)) throw new Error(`금액 미반영 (기대 ${item.amount}, 실제 ${v.WRBTR})`);
  if (v.BLDAT !== item.date) throw new Error(`증빙일 미반영 (기대 ${item.date}, 실제 ${v.BLDAT})`);
  if (!v.headerSGTXT) throw new Error('헤더 적요 미반영');
  if (String(v.headerWRBTR).replace(/[,\s]/g, '') !== String(item.amount)) throw new Error(`지급금액 미반영 (기대 ${item.amount}, 실제 ${v.headerWRBTR})`);
  return v;
}

// 증빙 파일 첨부: PC증빙 버튼 → filechooser (실패 시 qqfile input에 직접 주입)
async function attachFile(page, filePath) {
  const pcBtn = page.locator('button').filter({ hasText: 'PC증빙' }).first();
  let attached = false;
  if (await pcBtn.isVisible().catch(() => false)) {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }),
        pcBtn.click(),
      ]);
      await chooser.setFiles(filePath);
      attached = true;
    } catch (e) {
      log('  PC증빙 filechooser 실패, qqfile로 재시도:', e.message);
    }
  }
  if (!attached) await page.setInputFiles('input[name="qqfile"]', filePath);
  await page.waitForTimeout(6000); // 업로드 완료 대기

  const check = await page.evaluate((base) => {
    const t = document.body.innerText;
    return { hasName: t.includes(base), fileGroup: /file group id:\s*\S+/.test(t) };
  }, path.basename(filePath));
  if (!check.hasName && !check.fileGroup) throw new Error('첨부 확인 실패 — 화면에서 파일이 보이지 않음');
  log(`  첨부됨: ${path.basename(filePath)}`);
}

// 전표생성 버튼 클릭 → 전표번호 회수
async function clickCreate(page, tag) {
  const btn = page.locator('button.unidocu-button.blue').filter({ hasText: '전표생성' }).first();
  await btn.click();
  let belnr = null;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const modal = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('div')].find(
        (e) => e.getBoundingClientRect().width > 0 && /전표가 정상적으로 생성/.test(e.innerText || '') && e.innerText.length < 500
      );
      return dlg ? dlg.innerText : null;
    });
    if (modal) { belnr = (modal.match(/32\d{8}/) || [null])[0]; break; }
    const err = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[class*="dialog"]')].find(
        (e) => e.getBoundingClientRect().width > 0 && /입력해 주세요|오류|실패|확인해 주세요/.test(e.innerText || '')
      );
      return dlg ? dlg.innerText.replace(/\s+/g, ' ').slice(0, 200) : null;
    });
    if (err) throw new Error('전표생성 검증 실패: ' + err);
  }
  if (!belnr) throw new Error('전표생성 성공 모달을 확인하지 못함');
  log(`  ✔ 전표번호 ${belnr} 생성됨`);
  await page.screenshot({ path: path.join(OUT, `${stamp}-selfcare-created-${tag}.png`) });
  const contBtn = page.locator('button').filter({ hasText: '계속 작성' }).first();
  if (await contBtn.isVisible().catch(() => false)) await contBtn.click();
  await page.waitForTimeout(4000);
  return belnr;
}

async function createOne(page, item, i, { dry }) {
  log(`\n[${i + 1}] ${item.desc} ${item.amount.toLocaleString()}원 (${item.account} ${ACCOUNTS[item.account]}, 증빙일 ${item.date})`);
  await gotoMenu(page, '비용정산', '장려지원금');
  await page.waitForTimeout(2000);
  await fillForm(page, item);
  if (item.file) await attachFile(page, item.file);
  await page.screenshot({ path: path.join(OUT, `${stamp}-selfcare-form-${i + 1}.png`) });
  if (dry) {
    log('  [dry] 폼 입력까지만 — 전표생성 버튼 안 누름 (스크린샷: logs/)');
    return null;
  }
  return clickCreate(page, i + 1);
}

(async () => {
  const mode = process.argv[2] || 'plan';
  const items = loadItems();
  printPlan(items);
  if (mode === 'plan') return;

  const context = await launch({ headless: true });
  try {
    const page = await openEAC(context);
    page.on('dialog', async (d) => { log('  [다이얼로그]', d.message().slice(0, 150)); await d.accept(); });

    if (mode === 'dry') {
      await createOne(page, items[0], 0, { dry: true });
    } else if (mode === 'run') {
      const created = [];
      for (const [i, it] of items.entries()) {
        const belnr = await createOne(page, it, i, { dry: false });
        created.push({ ...it, belnr });
      }
      fs.writeFileSync(path.join(OUT, `${stamp}-selfcare-created.json`), JSON.stringify(created, null, 1));
      log(`\n전표생성 완료 ${created.length}건 — 상신은 EAC > 전자결재 > EA전표결재에서 직접 진행해 주세요.`);
      log('  (행 선택 → 그룹번호생성 → 결재요청 → 팝업에서 결재요청 클릭)');
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
