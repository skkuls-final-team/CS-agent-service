# Design: "가능하면 보내 주실 것" 한 줄을 "질문과 다름"으로 걸지 않는다

## Context

L8 지시문 v1의 OFF_TOPIC 정의는 "고객 메시지에서 초안이 다루지 않은 부분, 또는 고객이 묻지 않은 것에 답한 부분"이다(근거: `prompts/l8_verify_v1.md` 3번). L8 입력에는 그 하위 문의의 고객 요청 문장만 들어가고, 빠진 항목 목록은 들어가지 않는다(근거: `backend/app/llm/verify.py` fields, 명세서 v1.5 FR-049 입력). 그래서 L8은 끝의 "가능하면 보내 주십시오" 한 줄이 정책으로 넣은 문장인지 알 수 없다.

PR #105(fix-verify-status-list)는 고정 문안인 상태 목록을 코드로 거른다. 이 한 줄은 L4가 고객 언어로 쓰는 문장이라 위치·문장이 고정되지 않는다(근거: `backend/app/llm/drafts.py` optional_line, `prompts/l4_draft_v2.md` 8번).

## Goals / Non-Goals

- 목표: 정책으로 넣은 한 줄을 OFF_TOPIC으로 지적하지 않게 한다(근거: FR-021 처리 1, 가-5).
- 목표 아님: 가려진 값(`**MASKED**`) 처리, L4가 요청할 항목 고르기(근거: proposal 범위 밖).

## Decisions

| 항목 | 정한 것 | 근거 |
|---|---|---|
| 방법 | 지시문으로 알린다. 코드로 거르지 않는다 | 문장이 고정되지 않음(Context). 구현 선택 |
| 지시문 | `l8_verify_v2.md` = v1 + OFF_TOPIC 아래 "Do not report as OFF_TOPIC: (a) one sentence near the end that asks the customer to send missing details 'if available' — company policy adds it; (b) the 'Status of your requests' list." | FR-021 처리 1·가-5, FR-022 처리 3. (b)는 PR #105 코드 거르기와 겹치지만 L8이 처음부터 덜 지적하게 둔다. 문장은 구현 선택 |
| 이미 준 정보를 다시 묻기 | 지금처럼 지적 대상 | 고객 본문에 있는 정보를 다시 묻는 것은 질문과 다른 답(FR-049 처리 2). v2에 "unless the customer already gave that detail"을 넣는다 |
| 지시문 이름 | `L8_PROMPT = "l8_verify_v2.md"`. v1 파일은 남긴다 | 저장소 prompts/의 버전 파일 관례(l4_draft_v1~v3). 구현 선택 |

## 시험 (`backend/tests/acceptance/test_verification.py`)

| 시험 | 내용 | 근거 |
|---|---|---|
| 지시문 규칙 (대역 L8) | L8에 보낸 지시문에 v2 규칙 문장이 있다 | design 결정, 실행 기록 prompt_version |
| 제안 AC-049-8 (실제 Gemini) | "이미 최신" 안내 + 끝의 "가능하면 제조번호" 한 줄, 고객 본문에 제조번호 없음 → 그 한 줄에 OFF_TOPIC 없음 | spec 제안 AC-049-8. 정답지 본문은 쓰지 않고 시험용 문장을 쓴다 |

- 실제 확인: 서버를 다시 띄우고 CSV1-004030·004031·004032·004034(GS-078·079·080·013)에 [다시 검증] → 그 한 줄 지적이 사라지는지 본다. GS-079는 가려진 제조번호 문제로 "이미 준 번호를 또 묻는다"가 남을 수 있다(범위 밖).

## Risks / Trade-offs

- **언어 모델 판단이라 흔들린다** → 실제 Gemini 시험을 여러 번 돌려 본다. 걸러지지 않아도 발송은 막지 않는다(FR-049 처리 5).
- **"가능하면" 한 줄에 진짜 문제(묻지 않은 엉뚱한 요청)가 있어도 덜 잡을 수 있다** → 규칙을 "빠진 정보를 청하는 한 줄"로 좁히고, 이미 준 정보를 다시 묻는 경우는 그대로 지적하게 둔다.
- **실행 로그 시험의 지시문 이름이 바뀐다**: `test_run_log.py` `"Q14": "l8_verify_v1"` → `l8_verify_v2`. A 담당 파일이라 PR #104의 Q10 부탁과 함께 부탁한다(근거: 분담표 v3 "겹치지 않게 하는 규칙").
