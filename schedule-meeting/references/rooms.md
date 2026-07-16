# 직방 회의실 리소스 목록

회의실은 Google Calendar **리소스 캘린더**다. 이벤트에 넣을 때는:
1. `attendees`에 리소스 이메일을 참석자로 추가하고,
2. `location`에 회의실 이름(아래 표의 이름 그대로)을 적는다.

이름 끝 괄호 숫자는 **수용 인원**이다.

| 회의실 이름 | 리소스 이메일 | 인원 | 위치 |
|---|---|---|---|
| Zigbang-Lounge-B2-Room 1 (6) | c_1888jed45h18qg6mnou251k1tkqn0@resource.calendar.google.com | 6 | 라운지 B2 |
| Zigbang-Lounge-B2-Room 2 (6) | c_1889fo2vvmflsievimfggmm9a8duu@resource.calendar.google.com | 6 | 라운지 B2 |
| Zigbang-Lounge-B2-Room 3 (6) | c_1880drqv4c5faipknqu8rs3i94m96@resource.calendar.google.com | 6 | 라운지 B2 |
| Zigbang-Lounge-B2-Room 4 (10) | c_1886gqkpvio56ipgitdml15a2pea4@resource.calendar.google.com | 10 | 라운지 B2 |
| Zigbang-2-2F L3 (20) | c_1886f2j7gnkv0h28ha1so4hhn4cji@resource.calendar.google.com | 20 | 2관 2층 |
| Zigbang-2-2F L5 (20) | c_18899d5hojdmcjc4ks6n3casf7joe@resource.calendar.google.com | 20 | 2관 2층 |
| Zigbang-2-2F R5 (8) | c_188745p9hvjpig5jg40q0jbjuqirs@resource.calendar.google.com | 8 | 2관 2층 |
| Zigbang-Labs-B1-Haven (12) | c_188a75brquedshh6marcdeo37m810@resource.calendar.google.com | 12 | Labs B1 |

## 여기 없는 회의실을 요청받으면

회사에 위 목록 외의 회의실이 있을 수 있다 (이 목록은 Tyler가 최근 참석한 회의에서 추출한 것).
`search-events`로 그 회의실 이름이 들어간 과거 이벤트를 찾아 attendees에서 리소스 이메일을 확인하고,
찾으면 **이 표에 행을 추가**해 다음번에 재사용한다. 못 찾으면 Tyler에게 물어본다.
