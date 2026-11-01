# Design: 복합 문의 메일의 문의 상태 목록을 "질문과 다름"으로 걸지 않는다

## Context

`backend/app/llm/verify.py` verify_draft는 L8 지적 가운데 quote가 초안이나 대역에 없는 것을 버린다(근거: verify_draft, 명세서 v1.5 FR-049 처리 3). 복합 문의 메일은 `pipeline/compose.py` compose_mail이 "인사말 → 단락 → 상태 목록(머리 + 줄) → 맺음말"을 빈 줄(`\n\n`)로 이어 만든다(근거: compose_mail, FR-022 처리 3). 상태 목록 머리는 언어와 관계없이 영어 원문 "Status of your requests:"다(근거: `templates/status_list/en.json` head, compose.py template "영어 원문만 있다(부록 A-2, T40 전)").

[다시 검증] API는 DB의 본문으로 Draft를 다시 만들어 verify_draft를 부르므로 `draft.compose`가 없다(근거: `backend/app/api/messages.py` draft_object). 그래서 상태 목록은 본문에서 찾아야 한다.

## Goals / Non-Goals

- 목표: 상태 목록 안에만 있는 지적을 버려 복합 문의 메일의 헛경보를 없앤다(근거: proposal Why).
- 목표 아님: L8 지시문, 대역 쪽 지적, 단락의 지적(근거: proposal 범위 밖).

## Decisions

| 항목 | 정한 것 | 근거 |
|---|---|---|
| 상태 목록 찾기 | 본문에서 머리 문자열("Status of your requests:", `compose.template()["head"]`)이 처음 나오는 곳부터 다음 빈 줄(`\n\n`) 전까지(없으면 끝까지). 머리가 없으면 상태 목록 없음 | compose_mail이 부분을 `\n\n`으로 잇고 목록 안은 `\n`으로 이음. 머리 문자열은 템플릿 하나에서 가져와 두 곳이 어긋나지 않게 한다. 구현 선택 |
| 거르기 | 공백을 하나로 맞춘 quote가 공백을 하나로 맞춘 상태 목록 안에 들어 있으면 버린다. 항목(kind)과 상관없이 | 고정 문안은 어떤 항목으로도 판단 대상이 아님(FR-022 처리 3). L8 quote는 줄바꿈을 공백으로 바꿔 내는 경우가 있음(CSV1-004014 findings). 구현 선택 |
| 대역 | 대역의 지적은 거르지 않는다 | 대역의 상태 목록은 번역문이라 고정 문안이 아님(proposal 범위 밖) |
| 위치 | verify_draft 안, 지금의 "quote가 실제로 있는지" 거르기 옆 | FR-049 처리 3과 같은 종류의 코드 거르기. 처리 흐름·[다시 검증] 둘 다 지난다 |

## 시험 (`backend/tests/acceptance/test_verification.py`)

| 시험 | 내용 | 근거 |
|---|---|---|
| 제안 AC-049-7 (대역 L8) | 복합 메일 본문(단락 + 상태 목록)에 L8이 상태 목록 줄을 OFF_TOPIC으로 지적 → 지적 없음, ⑤ 통과 | spec 제안 AC-049-7 |
| 같은 메일, 단락 지적 | 단락 문장을 PROMISE로 지적 → 그대로 남음 | spec 제안 AC-049-7 "단락은 그대로" |
| 줄바꿈이 공백으로 바뀐 quote | 상태 목록 여러 줄을 공백으로 이은 quote도 버림 | design 결정 "거르기" |

## Risks / Trade-offs

- **상태 목록에 진짜 문제가 있어도 못 잡는다** → 목록은 코드가 고정 문안으로 만들고 줄 수도 코드가 검사한다(근거: FR-022 예외 1행 "상태 목록 누락"). 상담원이 직접 고친 목록의 문제는 놓칠 수 있으나, 고친 뒤에는 ⑤가 "고친 뒤 검증 안 함"이 된다(근거: 기술 명세서 §5-7 STALE).
- **llm 계층이 pipeline.compose를 가져온다**: 머리 문자열 하나만 쓴다. compose는 llm.drafts·llm.wrap만 가져와서 순환하지 않는다. 구현 선택.
