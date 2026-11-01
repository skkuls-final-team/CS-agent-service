# Design: 근거가 질문에 답하지 못하면 답변 초안을 만들지 않는다

## Context

답변 초안은 `backend/app/llm/drafts.py` write_reply가 만든다. 근거 후보(sources)가 비면 L4를 부르지 않고 `(None, [FLAG_NO_EVIDENCE_DRAFT])`를 돌려주며, 그 뒤 흐름은 초안 없음으로 간다(근거: drafts.py write_reply, 명세서 v1.5 FR-021 처리 2, 시험 `test_ac_021_3_no_evidence_no_draft`). 복합 문의에서는 초안이 없는 하위 문의를 다른 문의 메일의 상태 목록에 "담당자 확인 중"(S-6)으로 넣는다(근거: `backend/app/pipeline/graph.py` checking, `pipeline/compose.py` status_lines, FR-022 처리 7).

L4 지시문은 "묻는 것이 근거에 없으면 팀이 확인한다고 쓴다"를 규칙 1로 둔다(근거: `prompts/l4_draft_v2.md`·`l4_draft_v3.md` Hard rule 1, 에이전트 설계서 v1.1 4-6). 그래서 근거가 하나도 답하지 못해도 L4는 "팀이 확인하겠다" + 근거에 있는 무관한 사실로 초안을 채운다. 2026-11-01 GS-065~067 세 건이 이렇게 됐다(근거: proposal Why).

L4 응답은 지금 `body`, `citations`, `numbers_used` 세 칸이다(근거: drafts.py REPLY_SCHEMA). `generate_json`은 보내는 스키마와 코드가 검사하는 스키마를 따로 받을 수 있다(근거: `backend/app/llm/client.py` generate_json의 check_schema, L2가 이미 쓴다).

## Goals / Non-Goals

- 목표: 근거 후보와 조회값이 고객이 물은 것에 하나도 답하지 못하면 초안을 만들지 않고 "근거 없음 — 상담원 작성 필요"로 둔다(근거: FR-016 처리 5, FR-021 처리 2, AC-021-3).
- 목표: 일부라도 답하면 지금처럼 초안을 만든다. 정상 문의(추적표 CSV1-000004·000008, 팀 정답지의 기술 사양 문의)의 초안을 막지 않는다(근거: AC-021-1·021-2).
- 목표 아님: 검색 점수 문턱, "관련성 낮음" 표시, 검증 에이전트 지시문, 숫자 대조 허용 목록(근거: proposal 범위 밖).

## Decisions

### 1. L4 응답에 칸 하나를 더한다

| 항목 | 정한 것 | 근거 |
|---|---|---|
| 칸 | `coverage`: `ANSWERED`(물은 것에 모두 답함) / `PARTIAL`(일부만 답함, 나머지는 팀이 확인한다고 씀) / `NOT_IN_SOURCES`(근거·조회값·부서 회신 어디에도 물은 것의 답이 없음) | FR-016 처리 5, 에이전트 설계서 4-6 규칙 1. 이름·값은 구현 선택 |
| 보내는 스키마 | `coverage`를 required로 넣는다(enum 3값) | 구현 선택 |
| 검사하는 스키마 | `coverage`를 required에 넣지 않는다(check_schema). 칸이 없으면 `ANSWERED`로 본다 | 지금 시험의 가짜 L4 응답(FakeTransport, 세 칸)이 그대로 통과해야 함. client.py check_schema가 L2에서 같은 용도로 쓰임. 구현 선택 |
| 판단 주체 | L4 자신. 따로 호출을 더하지 않는다 | 에이전트 설계서 4-6 "근거 없는 말은 하지 않는다"가 L4의 정체성. 호출 수·지연을 늘리지 않음(기술 명세서 §3 L4 한 번). 구현 선택 |
| 점수 문턱 | 쓰지 않는다. T27(근거 없음 기준 = 빈 결과)은 그대로 | 무관한 후보 0.75~0.78이 정상 근거 0.66보다 높음(proposal Why). 에이전트 설계서 12-1 T27 |

### 2. write_reply의 처리

| 경우 | 동작 | 근거 |
|---|---|---|
| sources 없음 | 지금 그대로: L4를 부르지 않고 `(None, [FLAG_NO_EVIDENCE_DRAFT])` | FR-021 처리 2, AC-021-3 |
| L4가 `NOT_IN_SOURCES` | 다시 만들기(대조 실패 때의 2회째)를 하지 않고 바로 `(None, [FLAG_NO_EVIDENCE_DRAFT])`. 근거 후보 목록(evidence_json)은 그대로 저장된다 | FR-016 처리 5, FR-021 처리 2. evidence_json은 검색 단계가 이미 저장(기술 명세서 §4-4 4번) |
| `PARTIAL`·`ANSWERED`·칸 없음 | 지금 그대로(대조 → 1회 다시 → 표시) | FR-021 처리 5, 기술 명세서 §3-4 4번 |
| 1회째 `ANSWERED`인데 대조 실패로 2회째가 `NOT_IN_SOURCES` | 2회째 결과를 따른다(초안 없음) | 마지막 응답 기준. 구현 선택 |
| L4 두 번 실패 | 지금 그대로 "초안 생성 실패. 다시 시도" | FR-021 예외 1행 |

- 실행 로그의 Q10(L4) 출력에 `coverage`가 그대로 남는다. 상담원이 "왜 초안이 없나"를 실행 기록에서 볼 수 있다(근거: 명세서 FR-036 처리 2, 기술 명세서 §6-5).
- 화면은 고치지 않는다. 초안이 없으면 이미 "근거 없음 — 상담원 작성 필요"와 빈 편집기가 보인다(근거: SCR-03-AC-20, 변경 add-manual-draft).
- 자동 발송은 초안이 있어야 대상이 되므로, 초안이 없는 하위 문의는 자동 발송되지 않는다(근거: CLAUDE.md 규칙 3 예외 "같은 발송 함수", `backend/app/status/autosend.py`).

### 3. 지시문

| 파일 | 내용 | 근거 |
|---|---|---|
| `prompts/l4_draft_v4.md` | `l4_draft_v2.md`에 규칙 하나를 더한다: "Set coverage. ANSWERED if every question the customer asked is answered from <sources>/<lookups>; PARTIAL if at least one is answered and you wrote that our team will check the rest; NOT_IN_SOURCES if none of the questions is answered there. Facts in <sources> that the customer did not ask about do not count as an answer." | 에이전트 설계서 4-6 규칙 1, FR-016 처리 5. 문장은 구현 선택 |
| `prompts/l4_draft_v5.md` | `l4_draft_v3.md`(부서 회신 있음)에 같은 규칙. <dept_reply>도 답의 출처로 센다 | 변경 add-dept-reply C-162, 에이전트 설계서 12-1 가-6 |
| `drafts.py` | `L4_PROMPT = "l4_draft_v4.md"`, `L4_DEPT_PROMPT = "l4_draft_v5.md"` | 지시문은 새 파일로 바꾸고 옛 파일은 남긴다(저장소 prompts/의 v1~v3 관례). 구현 선택 |

- 고객 본문은 지금처럼 `<customer_message>` 안에만 둔다(근거: CLAUDE.md 규칙 5).
- "질문에 없는 사실은 답이 아니다" 문장은 GS-065~067처럼 같은 제품의 사양을 늘어놓는 경우를 막으려는 것이다(근거: proposal Why).

### 4. 복합 문의

- 고칠 것 없음. 하위 문의마다 write_reply를 부르고, 초안이 없으면 graph.py checking에 들어가 다른 문의 메일의 상태 목록에 "담당자 확인 중"으로 나온다(근거: graph.py, compose.py, FR-022 처리 7, AC-022-3).

### 5. 시험 (`backend/tests/acceptance/test_drafts.py`에 추가)

| 시험 | 내용 | 근거 |
|---|---|---|
| 제안 AC-021-6 (가짜 L4) | CSV1-000004 입력에 L4가 `coverage: NOT_IN_SOURCES`를 내면 초안이 없고 표시가 "근거 없음 — 상담원 작성 필요", L4는 한 번만 불림, 근거 후보는 남음 | spec 제안 AC-021-6, CLAUDE.md 규칙 7 |
| 제안 AC-021-7 (가짜 L4) | `PARTIAL`이면 초안이 있음 | spec 제안 AC-021-7 |
| 칸 없음 (가짜 L4) | 세 칸만 있는 응답이면 지금처럼 초안이 있음 (기존 시험이 이미 확인) | design 결정 1 check_schema |
| 제안 AC-021-8 (가짜 L4) | 복합 문의에서 한 문의만 `NOT_IN_SOURCES`면 그 문의는 초안 없음, 다른 문의 메일 상태 목록에 S-6 줄 | spec 제안 AC-021-8, AC-022-3 |
| 실제 Gemini (`@needs_key`) | CSV1-000004의 고객·제품으로 본문만 "RAL 9005 도장 가능?"으로 바꾼 문의 → 초안 없음. 같은 고객으로 CSV1-000004 원래 본문 → 초안 있음(AC-021-1 회귀) | spec 제안 AC-021-6, AC-021-1. 팀 정답지 본문은 저장소에 넣지 않으므로 시험용 문장을 따로 쓴다(score_team_gold.py 머리말 "정답지 파일은 저장소에 넣지 않는다") |
| 화면 (`frontend/e2e/scr-03-draft.spec.ts`) | 근거 후보는 있는데 초안이 없는 문의에서 "근거 없음 — 상담원 작성 필요"와 빈 편집기 | SCR-03-AC-20, 분담표 v3 B "새 시험은 새 파일 scr-03-draft에만" |

- 팀 정답지로 확인: `jobs/score_team_gold.py --only GS-065 GS-066 GS-067 GS-011 GS-013 GS-014 GS-015 GS-068`. GS-065~067은 초안 없음, 나머지는 초안 있음이어야 한다(근거: eval.gold_set 해당 행 expected_numbers·note). 채점 배치는 C 담당 파일이라 돌리기만 한다.

## Risks / Trade-offs

- **정상 문의를 `NOT_IN_SOURCES`로 잘못 버릴 수 있다** → 상담원은 빈 편집기에서 직접 쓸 수 있고(add-manual-draft), 팀 정답지의 답 있는 문의로 회귀를 본다(design 결정 5). 버리는 쪽이 무관한 초안이 승인·자동 발송되는 것보다 덜 위험하다(근거: 에이전트 설계서 4-6 정체성, CLAUDE.md 규칙 3 예외).
- **L4 판단도 흔들린다**(검증 에이전트가 GS-065만 놓친 것처럼) → 실제 Gemini 시험은 원래 흔들릴 수 있다고 본다(근거: 분담표 v3 "Gemini 실시간 시험 2개는 원래 흔들림"). 같은 판단을 L8도 한 번 더 보므로(OFF_TOPIC) 초안이 남아도 ⑤가 걸릴 수 있다(근거: FR-049).
- **실행 로그 시험의 지시문 이름이 바뀐다**: `backend/tests/acceptance/test_run_log.py` LLM_STEPS의 `"Q10": "l4_draft_v2"`가 `l4_draft_v4`가 된다. 이 파일은 A 담당이라 A에게 고쳐 달라고 부탁한다(근거: 분담표 v3 A "자동 시험 통과 확인: test_run_log", "겹치지 않게 하는 규칙").
- **에이전트 설계서 T27·4-6과 코드가 달라진다**: T27은 "근거 없음 기준 = 빈 결과(시작값)"인데 L4 판단이 더해진다. 주말에는 docs/를 고치지 않으므로 조장 확인 뒤 반영한다(근거: 분담표 v3 표 밖 규칙, CLAUDE.md "문서끼리 다르면 묻는다").
