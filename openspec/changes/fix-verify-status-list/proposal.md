# Proposal: 복합 문의 메일의 문의 상태 목록을 "질문과 다름"으로 걸지 않는다 (fix-verify-status-list)

## Why

복합 문의의 답변 메일 끝에는 하위 문의 n개의 현재 상태를 적은 "문의 상태 목록"을 붙인다(근거: 명세서 v1.5 FR-022 처리 3, D15). 목록은 고정 문안이다(근거: 에이전트 설계서 v1.1 부록 A-2 S-1~S-6, `backend/app/templates/status_list/en.json`, `backend/app/pipeline/compose.py` 머리말 "상태 문구는 고정 문안만 쓴다").

검증 에이전트(L8)는 초안 본문과 **그 하위 문의의** 고객 요청 문장을 받아 "질문과 다른 답"을 찾는다(근거: 명세서 FR-049 입력 "그 하위 문의의 고객 요청 문장", 처리 2). 그래서 상태 목록에 적힌 다른 하위 문의의 줄("2. Firmware update: we are still working on this.")을 고객이 묻지 않은 내용으로 보고 지적한다.

2026-11-01 팀 정답지 GS-068(질문 3개: 사양 + 펌웨어 + 견적)을 main `c68abb6` 서버에 접수했더니, 내용이 정답지와 모두 같은 메일 3통이 모두 "⑤ 걸림: 질문과 다름"이었다. 세 지적 모두 quote가 상태 목록 안이었다(근거: 시험 티켓 CSV1-004014의 VERIFY findings, 저장소 밖 `B_나송주_시험가이드.md`). 이대로면 복합 문의 메일은 늘 ⑤가 걸려 상담원에게 헛경보를 주고, 발송 때 "그래도 발송" 확인을 받게 된다(근거: FR-049 처리 4, AC-049-3).

## What Changes

- **상태 목록 안의 지적은 버린다**: 검증 결과의 지적 가운데 quote가 초안 본문의 문의 상태 목록(머리 "Status of your requests:"부터 그 단락 끝까지) 안에만 있는 것은 버린다. 목록은 고정 문안이라 언어 모델이 판단할 대상이 아니다(근거: FR-022 처리 3, FR-049 처리 3 "quote가 초안에 실제로 없으면 버린다"와 같은 코드 거르기).
- **처리 흐름과 [다시 검증] 둘 다**: 상태 목록을 본문에서 찾으므로 처리 흐름(Q14)과 [다시 검증] API가 같은 결과를 낸다(근거: `backend/app/pipeline/graph.py` verify, `backend/app/api/messages.py` verify, 두 곳 모두 `verify_draft`).
- 단일 문의 메일, 상태 목록 밖의 지적, 대역에서 나온 지적은 지금과 같다.

## Capabilities

### Modified Capabilities
- `verification`: 요구사항 "초안마다 뜻의 문제 4가지를 찾는다 (FR-049)"에 "문의 상태 목록 안의 지적은 버린다"를 더한다.

## 범위 밖

- **L8 지시문 고침**: 하지 않는다. 코드 거르기가 결과가 흔들리지 않는다(근거: 기술 명세서 v1.4 §3-4 "자체 대조는 코드").
- **대역의 상태 목록**: 대역(한국어)의 상태 목록은 번역문이라 고정 문안이 아니다. 대역에서 나온 지적은 지금처럼 둔다. 문제가 보이면 따로 다룬다.
- **펌웨어 초안의 "update available verdict" 같은 어색한 문장**: L4 문장 품질 문제로, 이 변경과 다르다.

## Impact

- 고치는 파일: `backend/app/llm/verify.py`(B 담당, 분담표 v3).
- 시험: `backend/tests/acceptance/test_verification.py`에 추가(근거: CLAUDE.md 규칙 7).
- API 응답 모양, 화면, 표·열, 지시문은 바꾸지 않는다.
