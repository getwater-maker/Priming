# 요청서 — wise-priming: 회원 포인트(지급·남음)를 priming_license 에 싣기

- **무엇을**: RPC `priming_license(p_device_id, p_device_name)` 응답 JSON 에 두 칸 추가 — `points_granted`(지급받은 포인트 합계, 숫자) · `points_remaining`(남은 포인트, 숫자). 값이 없는 회원은 칸을 빼거나 null.
- **왜**: Priming 앱 헤더 「모니터 끄기」 앞에 `🪙 남은 N / 지급 M` 을 보인다(로이 2026-10-18). 앱은 v0.9.72 에서 읽기·표시를 끝냈다 — 서버가 주기 전에는 아무것도 안 보인다.
- **어느 파일**: wise-priming 마이그레이션(포인트 테이블 또는 `enrollments` 에 칸) + `priming_license` 함수. 관리자 화면에서 회원별 지급 입력.
- **앱 쪽 약속**: 숫자가 아니면 무시 · 오프라인이면 마지막 성공 값을 그대로 보임 · 5분마다 다시 읽음 · 남은 10% 이하면 붉게.
- **미정**: 포인트를 무엇(음성·이미지·영상·MP4)에 얼마 차감할지 — 정해지면 서버 차감 RPC + 앱 호출을 별도 요청.
