# Tasks: 근거가 질문에 답하지 못하면 답변 초안을 만들지 않는다

## 0. 사람 확인 (구현 전)

- [x] 0.1 분담표 v3의 "'검증 못 함' 표시" 대신 "초안을 만들지 않음"으로 고치는 것 (proposal Why, 조장) — 2026-11-01 나송주 결정: 명세(FR-021 처리 2, AC-021-3)대로. "검증 못 함"은 AC-049-4의 표시라 쓰지 않음
- [ ] 0.2 에이전트 설계서 T27·4-6에 L4 판단(coverage)을 더할지, 언제 반영할지 (design Risks, 주말 뒤)
- [ ] 0.3 FR-016 예외 3행 "관련성 낮음" 표시를 근거 칸에 따로 붙일지 (proposal 범위 밖)
- [ ] 0.4 제안 AC-021-6·7·8을 명세서 FR-021에 넣을지 (spec)
- [ ] 0.5 A에게 `test_run_log.py`의 L4 지시문 이름 기대값(`l4_draft_v2` → `l4_draft_v4`)을 고쳐 달라고 부탁 (design Risks)

## 1. 지시문

- [x] 1.1 `prompts/l4_draft_v4.md` (v2 + coverage 규칙) (design 결정 3)
- [x] 1.2 `prompts/l4_draft_v5.md` (v3 + coverage 규칙, 부서 회신도 답의 출처) (design 결정 3)

## 2. 서버

- [x] 2.1 `llm/drafts.py` REPLY_SCHEMA에 coverage, 검사용 스키마(check_schema)에서는 선택 (design 결정 1)
- [x] 2.2 write_reply: NOT_IN_SOURCES면 다시 만들지 않고 `(None, [FLAG_NO_EVIDENCE_DRAFT])` (design 결정 2)
- [x] 2.3 지시문 이름을 v4·v5로 (design 결정 3)

## 3. 시험

- [x] 3.1 `test_drafts.py`: 제안 AC-021-6·7·8, 칸 없음, 실제 Gemini 한 쌍 (design 결정 5)
- [x] 3.2 `frontend/e2e/scr-03-draft.spec.ts`: 근거 후보가 있는데 초안이 없는 문의의 화면 (design 결정 5)
- [x] 3.3 팀 정답지 확인: `score_team_gold.py --only GS-065 GS-066 GS-067 GS-011 GS-013 GS-014 GS-015 GS-068` → GS-065~067 초안 없음, 나머지 초안 있음 (design 결정 5)
- [ ] 3.4 `pytest` 전체(`backend/tests/`)와 `npx playwright test` 전체를 돌려 AC-021-1·2·3, 제안 AC-021-6·7·8, AC-022-3, SCR-03-AC-20 통과 확인 — 2026-11-01 백엔드 전체 459 통과·3 실패(흔들리는 Gemini 2, test_run_log 1). 화면 시험 전체는 시연 DB에서 11/2 D가 돌림
