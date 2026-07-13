# EAC 법인카드 에이전트 월간 실행 (작업 스케줄러용)
# 매월 5일: 미처리 카드내역 → 임시전표 생성 (전기일 = 그달 1일, 상신은 수동)
Set-Location "$env:USERPROFILE\.claude\skills\corporate-card-settlement\agent"
if (-not (Test-Path logs)) { New-Item -ItemType Directory logs | Out-Null }
$log = "logs\monthly-$(Get-Date -Format yyyyMMdd-HHmmss).log"
& "C:\Program Files\nodejs\node.exe" submit.js run *>&1 | Out-File -FilePath $log -Encoding utf8
