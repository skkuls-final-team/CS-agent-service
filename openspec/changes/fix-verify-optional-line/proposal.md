# Proposal: "가능하면 보내 주실 것" 한 줄을 "질문과 다름"으로 걸지 않는다 (fix-verify-optional-line)

## Why

막는 항목 없이 빠진 항목만 있으면 답변 초안 끝에 "가능하면 보내 주실 것" 한 줄을 넣는다(근거: 명세서 v1.5 FR-021 처리 1, 에이전트 설계서 v1.1 12-1 가-5 "확정", 4-6 L4 지시문 규칙 "optional_missing_line").

검증 에이전트(L8)는 "고객이 묻지 않은 것에 답한 부분"을 OFF_TOPIC으로 지적한다(근거: 명세서 FR-049 처리 2 "질문과 다른 답", `prompts/l8_verify_v1.md` 3번). 그래서 정책으로 넣은 이 한 줄을 "고객이 묻지 않은 정보를 요구한다"고 지적한다.

2026-11-01 팀 정답지 확인에서 내용이 정답지와 같은 초안 4건이 이 한 줄 때문에 "⑤ 걸림: 질문과 다름"이었다: GS-013(CSV1-004034, "aplicación … si está disponible"), GS-078(CSV1-004030), GS-079(CSV1-004031), GS-080(CSV1-004032)(근거: 각 초안의 VERIFY findings quote·reason, 저장소 밖 `B_나송주_시험가이드.md` 5-2). 변경 fix-verify-status-list(PR #105)가 고친 상태 목록 헛경보와 같은 종류다.

이 한 줄은 고정 문안이 아니라 L4가 고객 언어로 쓰는 문장이라, PR #105처럼 코드로 위치를 찾아 거를 수 없다(근거: `backend/app/llm/drafts.py` optional_missing_line은 L4에 주는 지시이고 문장은 L4가 씀).

## What Changes

- **L8 지시문 새 버전**: `prompts/l8_verify_v2.md`에 "정책으로 넣는 두 가지 — 끝에 빠진 정보를 '가능하면' 보내 달라는 한 줄, 'Status of your requests' 목록 — 는 OFF_TOPIC으로 지적하지 않는다"를 더한다(근거: FR-021 처리 1·가-5, FR-022 처리 3).
- **가려진 값은 따로**: 고객이 이미 준 정보(본문에 있음)를 다시 묻는 것은 지금처럼 지적한다. 가려진 값(`**MASKED**`)을 빠진 것으로 보는 문제는 이 변경과 다르다(근거: proposal 범위 밖).
- `verify.py`의 지시문 이름을 v2로 바꾼다. 거르기 코드(PR #105)는 그대로 둔다.

## Capabilities

### Modified Capabilities
- `verification`: 요구사항 "초안마다 뜻의 문제 4가지를 찾는다 (FR-049)"에 "정책으로 넣는 '가능하면 보내 주실 것' 한 줄은 질문과 다름으로 보지 않는다"를 더한다.

## 범위 밖

- **가려진 값(`**MASKED**`)을 받은 정보로 칠지**: 팀 결정이 필요하다(분담표 v3 C "가린 일련번호 19건"). GS-077·079·CSV1-000007은 그 결정을 따른다.
- **L4가 쓰는 한 줄의 내용**(어떤 항목을 요청하는지): 이 변경은 검증만 다룬다.

## Impact

- 고치는 파일: 새 `prompts/l8_verify_v2.md`, `backend/app/llm/verify.py`(지시문 이름) — B 담당(분담표 v3).
- 시험: `backend/tests/acceptance/test_verification.py`에 추가(근거: CLAUDE.md 규칙 7).
- `backend/tests/acceptance/test_run_log.py`의 `"Q14": "l8_verify_v1"` 기대값이 `l8_verify_v2`가 된다. A 담당 파일이라 PR #104의 Q10 부탁과 함께 부탁한다.
- 이 변경은 PR #105(`feat/verify-status-list`) 위에 이어서 만든다(같은 파일 `verify.py`의 이웃 줄).
