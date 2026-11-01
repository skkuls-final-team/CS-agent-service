"""검증 에이전트 Q14·L8 (FR-049, 기술 명세서 v1.4 §3-2 L8, 에이전트 설계서 v1.1 4-10절).

초안을 한 번 더 읽어 코드 검사(Q11)가 못 잡는 뜻의 문제 4가지를 찾는다. 고치지 않고, 막지 않는다.
호출은 generate_json 하나를 지난다(CLAUDE.md 규칙 2).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.llm.client import LlmError, Transport, generate_json
from app.llm.drafts import GLOSS_LANGUAGE, LANGUAGE_NAMES, Draft, Source
from app.pipeline.compose import template
from app.pipeline.state import VerifyFinding

L8_PROMPT = "l8_verify_v2.md"  # v1 + 정책 문장(가능하면 보내 주실 것, 상태 목록) 예외(변경 fix-verify-optional-line)
STATUS_HEAD = template()["head"]  # 복합 문의 메일의 문의 상태 목록 머리(FR-022 처리 3, 고정 문안)

GLOSS_KIND = "GLOSS_MISTRANSLATION"
KIND_NAMES = {  # 화면 이름 (4-10절 결과 모양)
    "MEANING_MISMATCH": "뜻 다름",
    "PROMISE": "약속 표현",
    "OFF_TOPIC": "질문과 다름",
    GLOSS_KIND: "대역 오역",
}

SCHEMA: dict = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(KIND_NAMES)},
                    "quote": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["kind", "quote", "reason"],
            },
        }
    },
    "required": ["findings"],
}


@dataclass
class VerifyResult:
    """검증 1회 결과. 칸 이름은 eval.self_check(check_type = VERIFY) 열을 따른다(passed_yn, detail, checked_at_utc)."""

    findings: list[VerifyFinding] = field(default_factory=list)
    gloss_checked: bool = True
    error: str | None = None  # LLM_TIMEOUT / LLM_INVALID_OUTPUT …
    checked_at_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def passed_yn(self) -> bool:
        return self.error is None and not self.findings

    @property
    def state(self) -> str:
        """⑤ 상태 (기술 명세서 §5-7). STALE(고친 뒤 검증 안 함)은 임시 저장이 생기는 9번 변경에서."""
        return "FAILED" if self.error else "FOUND" if self.findings else "PASSED"

    def by_kind(self) -> dict[str, str]:
        """항목별 결과 (FR-049 처리 3·출력): 문제 있음 / 문제 없음 / 확인 못 함."""
        out = {}
        for kind in KIND_NAMES:
            if self.error or (kind == GLOSS_KIND and not self.gloss_checked):
                out[kind] = "확인 못 함"
            else:
                out[kind] = "문제 있음" if any(f.kind == kind for f in self.findings) else "문제 없음"
        return out

    def detail(self) -> dict[str, Any]:
        if self.error:
            return {"error": self.error}
        return {"findings": [f.model_dump() for f in self.findings], "gloss_checked": self.gloss_checked}

    def mark(self) -> str:
        """검토 표시 ⑤ 문구 (FR-049 처리 4·7, 4-10절 대역 없음)."""
        if self.error:
            text = "⑤ 검증 못 함(실패)"
        elif self.findings:
            names = [KIND_NAMES[k] for k in KIND_NAMES if any(f.kind == k for f in self.findings)]
            text = "⑤ 걸림: " + ", ".join(names)
        else:
            text = "⑤ 통과"
        if not self.gloss_checked and not self.error:
            text += " (대역 없음: ④ 확인 못 함)"
        return text


def status_block(body: str) -> str:
    """본문의 문의 상태 목록: 머리부터 그 단락 끝(빈 줄)까지. compose_mail이 부분을 빈 줄로 잇는다. 없으면 빈 글."""
    start = body.find(STATUS_HEAD)
    if start < 0:
        return ""
    end = body.find("\n\n", start)
    return body[start:] if end < 0 else body[start:end]


def _flat(text: str) -> str:
    return " ".join(text.split())  # L8 quote는 줄바꿈을 공백으로 바꿔 내기도 한다


def verify_draft(
    transport: Transport,
    draft: Draft,
    evidence_sentences: list[str],
    sources: list[Source],
    lookups: list[tuple[str, Any, str | None, str]],
    dept_reply: str = "",  # 이관 부서 회신(있을 때, §2-2 Q14 입력)
) -> VerifyResult:
    gloss_body = draft.gloss.body if draft.gloss else ""
    fields = {
        "language_name": LANGUAGE_NAMES.get(draft.language, draft.language),
        "gloss_language_name": LANGUAGE_NAMES[GLOSS_LANGUAGE],
        "evidence_sentences": "\n".join(evidence_sentences),
        "sources": "\n\n".join(f"[{s.doc_id} §{s.section_no}] {s.title}\n{s.text}" for s in sources),
        "lookups": "\n".join(f"{item} | {value} | {unit or ''} | {source}" for item, value, unit, source in lookups),
        "dept_reply": dept_reply,
        "draft_body": draft.body,
        "gloss_body": gloss_body,
    }
    gloss_checked = bool(gloss_body)
    try:
        data = generate_json(transport, "L8", L8_PROMPT, fields, SCHEMA).data
    except LlmError as exc:
        return VerifyResult(gloss_checked=gloss_checked, error=exc.error_type)
    kept = []
    status = _flat(status_block(draft.body))
    for item in data["findings"]:
        quote = item["quote"].strip()
        if item["kind"] == GLOSS_KIND and not gloss_checked:
            continue  # 대역이 없으면 ④는 보지 않는다
        if status and _flat(quote) in status:
            continue  # 문의 상태 목록은 고정 문안이라 판단 대상이 아니다(변경 fix-verify-status-list)
        if quote and (quote in draft.body or (gloss_body and quote in gloss_body)):
            kept.append(VerifyFinding(kind=item["kind"], quote=quote, reason=item["reason"]))
    return VerifyResult(kept, gloss_checked)
