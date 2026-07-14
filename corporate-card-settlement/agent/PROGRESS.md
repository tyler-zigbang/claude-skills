# EAC 법인카드 결재 자동화 에이전트 — 진행 상황

## 목표
eac.zigbang.in(직방 전자결재, Google SSO)에서 법인카드 사용내역을 불러와
전표를 자동 생성하는 에이전트. **최종 상신은 Tyler가 직접** (2026-07-10 결정).

## 사용법
```
node status.js           # 현재 상태 확인 (읽기 전용)
node submit.js plan      # 미처리 내역 + 분류 결과 미리보기 (읽기 전용)
node submit.js run       # 미처리 내역 전부 전표생성 (상신 안 함) — 월간 실행용
node submit.js create N  # 앞에서 N건만 전표생성
node submit.js approve   # 그룹생성→결재요청→상신까지 (현재 정책상 사용 안 함)
```
상신 수동 절차: EAC > 전자결재 > EA전표결재 > 행 선택 > (그룹 없으면 그룹번호생성) > 결재요청 > 팝업에서 결재요청 클릭.

## 아키텍처 (전부 검증됨)
- Playwright + 실제 Chrome + 영구 프로필(./profile), Google SSO 세션 재사용
- EAC는 UniDocu(유니포스트) 기반, 그리드는 RealGridJS 1.1.41 (canvas 렌더링 → DOM 클릭 불가)
- **그리드 제어는 JS API로**: `require(['uni_realgrid/wrapper/realgridWrapper'])` → `getGrid('unidocu-grid')`
  - 데이터 읽기 `getJSONData()`, 체크 `$V('SELECTED', i, '1')`, 셀 입력 `$V('HKONT', 0, code)`
  - 계정코드 입력 후 **반드시 `fillPopupText()`** 호출해야 계정명 조회·검증 통과
- 폼 필드는 `$u.get('SGTXT').setValue(...)` + input change 트리거
- 문서 열람은 `$ewf.popup.openDRAFT_0011(row)` (팝업 창으로 열림)
- 세금코드(MWSKZ)는 폼이 자동 판정 (TAX>0→V3, TAX=0→T0) — 건드리지 않음

## 분류 규칙 (lib/classify.js — Tyler 과거 상신 문서에서 학습)
- 택시/교통(MCC) → 52040101 판)여비교통비-시내교통비
  - 적요: 승인시각 10:00~18:00 "업무미팅이동", 그 외 "출퇴근이용" (2026-07-10 Tyler 지시)
- 커피숍/제과(MCC) → 52010102 판)복리후생비-회식대, 적요 "스마트홈 음료"
- 식당(MCC) → 52010102, 적요 "스마트홈 조식/중식/석식" (시간대별)
- 분류불가 → 자동 처리에서 제외하고 로그로 보고 (예: 정화흥산(주)/완구점)
- 해외출장 계정: 52040301 항공료, 52040302 기타교통비, 52040303 숙박비, 52040304 식대, 52040305 기타 (참고용)
- 결재선(과거): 경비검토(성민지) → Leah Song(송현아). 상신 팝업이 제목 자동 생성 ("<첫 적요> 외 N건")

## 진행 상태
- [x] 로그인/세션, 화면 구조 파악, 분류 규칙, 전표생성 파이프라인 완성
- [x] 2026-07-10 실행: 8건 전표생성 완료 (3200010171~77 + 3200010180, 그룹 FI20260000026144, 미상신)
      — 정화흥산(주)는 카페로 확인되어 개별 규칙 추가 (MCC "완구점"은 오등록)
- [x] 전기일(BUDAT) = 실행하는 달의 1일로 자동 설정 (2026-07-10 Tyler 지시, test-budat.js로 검증)
- [x] 작업 스케줄러 등록: "EAC Card Agent Monthly" — 매월 5일 09:00, run-monthly.ps1
      (놓친 실행은 PC 켜지면 실행, 로그: logs/monthly-*.log)
- [x] 2026-07-13 실행: 15건 전표생성 완료 (3200010229~3200010243, 분류불가 0건, 미상신)
- [x] 2026-07-13 이관: `~/eac-card-agent` → **`~/.claude/skills/corporate-card-settlement/agent`** (스킬에 통합, claude-skills repo 백업).
      작업 스케줄러·run-monthly.ps1·SKILL.md 2개·flex trip-capture-slip.js/trip-roaming.js 경로 갱신 완료.
      business-trip-settlement 스킬도 이 agent 폴더를 공용으로 사용 (trip.js)
- [ ] Tyler가 EAC에서 상신 (결재요청 버튼만 누르면 됨)
- [ ] Slack 알림 연동 (실행 결과 + 분류불가 건 통보)

## 출장비(일반경비) 봇 — trip.js (2026-07-13 추가)
- 출장비 정산 = 비용정산 > **일반경비** (FI_22), 경비 1건 = 전표 1개
- 과거 패턴(Zigbang-회계전표-2026-0000022900): 전표유형 KE, 사업영역 K200, 조정계정 21020103(미지급금-종업원, ZB00896 정진우),
  세금 T0, 지급방법 R(실시간이체), CC 226020, 증빙일=지출일, 헤더적요=라인적요, 첨부 없음
- 해외출장 계정: 52040301 항공료 / 52040302 기타교통비 / 52040303 숙박비 / 52040304 식대 / 52040305 기타
- 입력: `trip-items.json` `[{date:"YYYYMMDD", desc, account, amount}]`
- 사용법: `node trip.js plan`(검증·미리보기) → `node trip.js dry`(폼 채우기만) → `node trip.js run`(전표생성, 상신 안 함)
- 헤더 필드는 `$u.get('BLDAT'|'SGTXT'|...)`, 라인은 그리드 `$V('HKONT'|'WRBTR'|'SGTXT', 0, v)` + `fillPopupText()`
- **지급금액(헤더 WRBTR)은 필수** — fillPopupText가 리셋하므로 그리드 입력 후 마지막에 setValue (trip.js에 반영됨)
- **품의 첨부(원품의)는 파일이 아니라 flex 문서 URL** (상신 팝업의 그리드에 ITKD_TXT=원품의 + flex workflow-task-key URL 행)
  → 원품의 URL은 ~/flex-fitness-agent/trip-collect.js로 수집 (삼성카드 출장기간 결제내역도 함께)
- 2026-07-13 현황: 6/24~6/30 중국출장(베이징2박·중산4박)의 호텔/항공/로밍보험 3건(2,019,709원)은
  이미 7/6 상신되어 결재 진행중 (그룹 FI20260000026002). 이번 정산 = 그 외 삼성카드 현지 지출분(식대·교통 추정).
  대한항공 영수증 284,300원(6/22 구매)은 상신된 항공비용에 포함됐을 수 있어 **중복 주의** — 전표 안 만들었음
- 2026-07-13 생성: **3200010188** 공항 이동 택시 11,000원 (증빙: inbox/taxi-20260630-11000.png).
  6월 출장 나머지(호텔·항공·로밍)는 이미 정산 완료 — **이 봇은 다음 출장 정산용 준비** (Tyler 지시)

### 다음 출장 정산 런북 (상신 전까지 자동)
1. 삼성카드 결제 확인: `cd ~/flex-fitness-agent && node trip-collect.js --from 2026.MM.DD --to 2026.MM.DD`
   (headed, 삼성카드 로그인 필요 — 10분 세션이라 매번 로그인. flex 로그인도 이어서 하면 원품의 후보까지 수집)
2. 증빙 캡처: 건별로 `node trip-capture-slip.js --date 2026.MM.DD --amount N --name 이름`
   → ~/.claude/skills/corporate-card-settlement/agent/inbox/에 저장됨
   로밍요금: `node trip-roaming.js --from 2026.MM.DD --to 2026.MM.DD` — T월드 요금안내서 >
   로밍 이용요금 상세조회에서 출장기간 조회(달력 위젯 자동 조작) 후 **공식 로밍청구내역서를 PDF+PNG로 inbox에 저장**
   (금액도 로그로 출력). 세션 만료 시 자동 headed 전환(로그인 필요, 쿠키 out/tworld-cookies.json).
   ※ 로밍요금은 사용 다음 달 청구 (해외사업자 자료 지연 시 최대 3개월) — 귀국 다음 달에 실행
3. ~/.claude/skills/corporate-card-settlement/agent/trip-items.json 작성 (date/desc/account/amount/file) → `node trip.js plan` → `run`
4. 상신(Tyler 수동): EA전표결재 → 행 선택 → 그룹번호생성 → 결재요청 → 팝업에서 제목 확인,
   **품의 첨부에 flex 출장품의서 URL 추가**(원품의) → 결재요청. 원품의 URL은 flex 내문서함에서 해당 출장품의서 열어 복사
   (또는 `node trip-flex-wonpum.js`로 "출장" 검색 자동 수집 — 내가 작성한 문서 필터)
- 주의: 호텔·항공을 법인카드/사전정산으로 이미 냈는지 EA전표결재·완료함에서 먼저 확인 (중복 정산 방지)

## 자기관리비(장려지원금) 봇 — selfcare.js (2026-07-14 추가, 스킬: self-care-allowance)
- 자기관리비/가족식사비 = 비용정산 > **장려지원금** (FI_21). 화면 구조는 일반경비(FI_22)와 동일 → trip.js 복제·수정
- 과거 패턴(Zigbang-회계전표-2026-0000022872 "자기관리비(미용)" 49,000원, 0000022962 "2사분기 가족식사비" 202,000원):
  전표유형 KE, 사업영역 K200, 조정계정 21020103(ZB00896 정진우), 세금 T0, 지급방법 R,
  지급조건 V123(익월 23일), CC 226020, 증빙일=지출일, **첨부 0건으로도 결재 통과** (그래도 첨부 권장)
- 계정: 52010108 판)복리후생비-자기관리비 | 52010109 판)복리후생비-가족식사비
- 폼 기본값(BLART/GSBER/ZLSCH/MWSKZ/LIFNR/ZTERM/KOSTL)이 이미 과거 패턴과 일치 — BLDAT·SGTXT·HKONT·WRBTR만 입력
- 입력: `selfcare-items.json` (예시: selfcare-items.example.json), 사용법: `node selfcare.js plan → dry → run`
- 증빙: 삼성카드 매출전표 캡처는 ~/flex-fitness-agent/trip-capture-slip.js 재활용 (inbox/에 저장)
- 결재선(과거): 경비검토(성민지) → Leah Song(송현아)
- 2026-07-14 dry 검증 완료 (폼 입력·계정명 조회·지급예정일 자동계산 확인, 전표생성은 안 누름)

## 주의
- explore*.js는 개발 중 탐색 스크립트 (지워도 됨). 산출물은 lib/, submit.js, status.js, trip.js, selfcare.js
- 세션 만료 시 `node login.js`로 재로그인 (headed 브라우저)
