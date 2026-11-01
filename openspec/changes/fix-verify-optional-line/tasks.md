# Tasks: "가능하면 보내 주실 것" 한 줄을 "질문과 다름"으로 걸지 않는다

## 0. 사람 확인

- [ ] 0.1 제안 AC-049-8을 명세서 FR-049에 넣을지 (spec, 조장)
- [ ] 0.2 A에게 `test_run_log.py`의 `"Q14": "l8_verify_v1"` → `l8_verify_v2` 부탁 (PR #104의 Q10과 함께) (design Risks)

## 1. 지시문·서버

- [x] 1.1 `prompts/l8_verify_v2.md` (v1 + OFF_TOPIC 예외 규칙) (design 결정)
- [x] 1.2 `llm/verify.py` 지시문 이름 v2 (design 결정)

## 2. 시험

- [x] 2.1 `test_verification.py`: 지시문 규칙(대역), 제안 AC-049-8(실제 Gemini) (design 시험)
- [x] 2.2 CSV1-004030·004031·004032·004034 [다시 검증] → "가능하면" 한 줄 지적이 사라지는지 확인 — 2026-11-01 GS-078·080·013 → "검사 5개 통과". GS-079는 가려진 제조번호를 또 묻는다는 지적이 남음(범위 밖, MASKED). 같은 시험 문장을 v1은 5/5 지적, v2는 0/5
- [x] 2.3 `pytest` 전체를 돌려 AC-049-1~6, 제안 AC-049-7·8 통과 확인 — 2026-11-01 460 통과 · 3 실패(흔들리는 Gemini 2 + test_run_log Q14 l8_verify_v1→v2, A에게 부탁) · 1 건너뜀
