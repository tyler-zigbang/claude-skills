// 카드 사용건 분류: 업종(MCC) 우선, 가맹점명 보조 → 계정코드 + 적요
// Tyler의 과거 상신 문서에서 학습한 패턴:
//   식당/카페  → 52010102 판)복리후생비-회식대, 적요 "스마트홈 중식/석식/음료"
//   택시/교통  → 52040101 판)여비교통비-시내교통비, 적요 "출퇴근이용"
// 세금코드(MWSKZ)는 폼이 자동 판정하므로 건드리지 않음.

const ACCOUNTS = {
  MEAL: { code: '52010102', name: '판)복리후생비-회식대' },
  TRANSPORT: { code: '52040101', name: '판)여비교통비-시내교통비' },
};

function mealByHour(hour) {
  return hour < 11 ? '조식' : hour < 15 ? '중식' : '석식';
}

// 택시/교통 적요: 10시~18시는 업무미팅 이동, 그 외(출근/퇴근 시간대)는 출퇴근 (2026-07-10 Tyler 지시)
function transportSgtxt(hour) {
  return hour >= 10 && hour < 18 ? '업무미팅이동' : '출퇴근이용';
}

function classify(row) {
  const merch = row.MERCH_NAME || '';
  const mcc = row.MCC_NAME || '';
  const hour = parseInt((row.APPR_TIME || '12:00').slice(0, 2), 10);

  // 0순위: 가맹점 개별 규칙 (업종 데이터가 잘못된 가맹점 — Tyler 확인)
  if (/정화흥산/.test(merch)) {
    // 카페 (MCC는 "완구점"으로 잘못 등록되어 있음, 2026-07-10 Tyler 확인)
    return { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 음료' };
  }

  // 1순위: 업종(MCC) 기반
  if (/택시|버스|철도|고속도로|주차|교통|여객/.test(mcc)) {
    return { ...ACCOUNTS.TRANSPORT, sgtxt: transportSgtxt(hour) };
  }
  if (/커피|카페|제과|베이커리|음료|다과/.test(mcc)) {
    return { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 음료' };
  }
  if (/한식|일식|중식|양식|음식|식당|분식|주점|치킨|피자|패스트푸드|뷔페|레스토랑/.test(mcc)) {
    return { ...ACCOUNTS.MEAL, sgtxt: `스마트홈 ${mealByHour(hour)}` };
  }
  if (/편의점|슈퍼|마트|잡화/.test(mcc)) {
    return { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 음료 및 다과' };
  }

  // 2순위: 가맹점명 기반
  if (/택시|버스|KTX|SRT|주차|톨게이트|하이패스/.test(merch)) {
    return { ...ACCOUNTS.TRANSPORT, sgtxt: transportSgtxt(hour) };
  }
  if (/김밥|국밥|설농탕|설렁탕|찌개|초밥|족발|고기|횟집|식당|밥|면|국수/.test(merch)) {
    return { ...ACCOUNTS.MEAL, sgtxt: `스마트홈 ${mealByHour(hour)}` };
  }
  if (/카페|커피|스타벅스|투썸|이디야|폴바셋|아티제|파리바게|뚜레|던킨|배스킨/.test(merch)) {
    return { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 음료' };
  }

  // 분류 불가: uncertain 표시 → 자동 상신에서 제외하고 보고
  const guess =
    hour >= 11 && hour <= 14
      ? { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 중식' }
      : hour >= 17 && hour <= 21
        ? { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 석식' }
        : { ...ACCOUNTS.MEAL, sgtxt: '스마트홈 음료 및 다과' };
  return { ...guess, uncertain: true };
}

module.exports = { classify, ACCOUNTS };
