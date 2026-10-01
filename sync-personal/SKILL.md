---
name: sync-personal
description: 사무실에서 하던 개인 Claude 작업(영상 만들기 등)을 집에서 이어서 하기 위해 개인 프로젝트를 개인 깃(fiveflute-collab)으로 동기화한다. "동기화 해줘", "사무실 작업 밀어줘", "집에서 이어서 하게", "개인 프로젝트 push/pull", "sync push", "sync pull" 같은 요청에 적합하다. 사무실 퇴근 시 push, 집(또는 다른 PC) 시작 시 pull.
---

# 개인 프로젝트 동기화 (사무실 ↔ 집)

Tyler의 개인 Claude 작업(영상 등)을 PC 간에 이어서 하도록, 개인 깃(GitHub `fiveflute-collab`)으로 동기화한다. 결정적 동작은 아래 스크립트가 수행하고, 너는 실행·결과 요약·문제 안내를 담당한다.

## 동기화 대상 (개인 repo 8개)
- `obgyn-video` (영상), `clinic-scribe`, `stock-agent`(→korea-stock-agent), `longterm-agent`
- `obgyn-clinic-simulator` (2026-10-01 추가), `obgyn-animation` (구 mp4 아카이브, 2026-10-01 추가 — 깃 초기화 전이면 SKIP됨)
- `.claude\automation\etf-screener` (ebot → etf-screener), `.claude\automation` (→claude-automation: monday-digest·send_html.py·run 스크립트, etf-screener 폴더는 .gitignore로 제외)
- 모두 `fiveflute-collab` 소유. 목록 변경은 스크립트의 `$repos` 배열을 수정한다.

## 모드
| 언제 | 모드 | 뜻 |
|---|---|---|
| **사무실 퇴근 시** | `push` | 미커밋 변경을 자동 커밋 + 개인 깃에 푸시 |
| **집/다른 PC 시작 시** | `pull` | 개인 깃에서 최신으로 당김 |
| 상태만 확인 | `status` | 각 repo의 브랜치·미커밋 수·ahead/behind |

사용자가 방향을 명시 안 하면 물어본다(밀기 vs 당기기). "이어서 하게/집에서" 는 pull, "밀어/올려/백업" 은 push로 해석해도 된다.

## 실행 방법
아래를 Bash 도구로 실행한다(모드만 바꿔서):

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Tyler Jeong\.claude\skills\sync-personal\sync-personal.ps1" -Mode push
```

- 스크립트가 gh 활성 계정을 자동으로 `fiveflute-collab`으로 전환 → 작업 → 회사 계정(`tyler-zigbang`)으로 복원한다. (계정 전환은 [[git-account-switch]] 스킬과 동일 원리)
- 종료코드 = 실패한 repo 수. 0이면 전부 성공.

## 결과 보고 (한국어)
스크립트 출력(영문)을 읽고 사용자에게 한국어로 요약한다:
- 각 repo별 `PUSH ok` / `PULL ok` / 실패·건너뜀을 표나 목록으로.
- **push 실패**(예: `PUSH FAILED: ... Repository not found`)면 gh 계정 전환 문제일 수 있으니 [[git-account-switch]]로 진단 안내.
- **pull 건너뜀**(`SKIPPED pull: N uncommitted change(s)`)이면 그 PC에 저장 안 한 로컬 변경이 있다는 뜻 → 먼저 그 PC에서 push하거나 정리하라고 안내(임의로 stash/삭제하지 말 것).
- **pull needs attention**(ff-only 실패)이면 양쪽에서 갈라진 것 → 사용자에게 어느 쪽을 살릴지 확인 후 처리.

## 원칙
- 파일 내용은 건드리지 않는다. 커밋 메시지는 `sync from <PC이름> <시각>` 자동 생성.
- 큰 영상 파일도 현재 repo 그대로 동기화된다(GitHub 100MB/파일 제한 초과 파일이 새로 생기면 push 실패하므로, 그럴 땐 사용자에게 Drive 병행을 제안).
- 대화 세션에서 직접 커밋/푸시할 때는 반드시 gh 활성 계정이 개인(`fiveflute-collab`)인지 먼저 확인한다.
