"""고객에게 가는 글의 초안: L3 정보 요청(FR-015), L4 답변(FR-021), L7 대역(FR-039).

모두 DRAFT로만 만든다(CLAUDE.md 규칙 3). 호출은 generate_json 하나를 지난다(규칙 2).
에이전트 설계서 v1.1 4-5·4-6·4-9절, 기술 명세서 v1.4 §3-1~3-4.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.checks.draft_check import CheckResult, check_draft, number_values, numbers, same_citations_and_numbers
from app.llm.client import LlmError, Transport, generate_json, load_prompt
from app.retrieval.numbers import VERDICT_LATEST, VERDICT_UPDATE

L3_PROMPT = "l3_info_request_v1.md"
L4_PROMPT = "l4_draft_v4.md"  # v2 + coverage 규칙(변경 fix-draft-no-relevant-evidence)
L4_DEPT_PROMPT = "l4_draft_v5.md"  # 부서 회신이 있을 때만(<dept_reply> 칸, 변경 add-dept-reply C-162). v3 + coverage 규칙
L7_PROMPT = "l7_gloss_v1.md"
SKELETONS_FILE = "l4_category_skeletons_v1.md"

VERDICT_EN = {VERDICT_LATEST: "already the latest version", VERDICT_UPDATE: "update available"}
GLOSS_LANGUAGE = "ko"  # FR-039 처리 1 (기본 한국어)
# L4 모드 (에이전트 설계서 4-6: 단일 문의 = 완성문 / 복합 문의 = 단락)
MODE_SINGLE = "Write the full email body."
MODE_COMPOSITE = "Write ONE paragraph for this request only; greeting and closing are added separately."
MAX_REPLY_CHARS = 1500  # FR-021 예외 4행 (제안 상한)
# 숫자 대조에서 허용하는 제공 항목: 수량, 고객 버전, 날짜 (기술 명세서 §3-4 2번, 에이전트 설계서 6-1절)
CHECK_PROVIDED_FIELDS = {"quantity", "current_fw", "tool_version", "required_date", "install_date"}

FLAG_AUTO_TRANSLATE_FAILED = "자동 번역 실패"
FLAG_NO_EVIDENCE_DRAFT = "근거 없음 — 상담원 작성 필요"
FLAG_DRAFT_FAILED = "초안 생성 실패. 다시 시도"
FLAG_TOO_LONG = "초안 길이 초과"
FLAG_CHECK_FAILED = "인용·숫자 불일치"
FLAG_GLOSS_FAILED = "대역 없음(번역 실패)"
FLAG_GLOSS_MISMATCH = "인용·숫자 확인"

LANGUAGE_NAMES = {  # 15개 언어 코드 → 영어 이름 (구현 선택)
    "ar": "Arabic", "de": "German", "en": "English", "es": "Spanish", "fr": "French",
    "id": "Indonesian", "it": "Italian", "ja": "Japanese", "pl": "Polish", "pt": "Portuguese",
    "ru": "Russian", "th": "Thai", "tr": "Turkish", "vi": "Vietnamese", "zh": "Chinese", "ko": "Korean",
}
CATEGORY_NAMES = {  # 유형 10종 → 영어 이름 (구현 선택)
    "TECH_SPEC": "technical specification", "INSTALL": "installation and commissioning",
    "DEFECT": "fault", "FW_UPDATE": "firmware update", "MANUAL": "manual and document",
    "COMPLIANCE": "certification and compliance", "QUOTE": "quotation", "ORDER_LEAD": "order and lead time",
    "RETURN": "return and exchange", "WARRANTY": "warranty",
}


@dataclass
class Gloss:
    language: str
    body: str
    numbers_match: bool = True
    made_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))  # §2-2 Q13 made_at


@dataclass
class Draft:
    """고객에게 갈 글 한 통. 칸 이름은 svc.ticket_message·svc.message_gloss 열을 따른다."""

    sub_ticket_id: str
    message_type: str  # INFO_REQUEST / FINAL_REPLY
    language: str
    body: str
    sender: str = "SYSTEM"
    message_status: str = "DRAFT"
    mask_count: int = 0
    requested_fields: list[str] = field(default_factory=list)
    citations: list[dict[str, str]] = field(default_factory=list)
    lookups_used: list[dict[str, Any]] = field(default_factory=list)  # FR-021 출력 "사용한 조회값 목록"
    check: dict[str, Any] | None = None
    gloss: Gloss | None = None
    verify: Any = None  # 검증 에이전트 결과(app.llm.verify.VerifyResult, FR-049)
    compose: dict[str, Any] | None = None  # 복합 문의 메일 구성 결과(T5, FR-022). 단일 문의는 None
    flags: list[str] = field(default_factory=list)
    input_fields: list[str] = field(default_factory=list)  # L4에 넣은 항목 이름(실행 기록 Q10 input_json, AC-018-4)


# --- L3 정보 요청 (FR-015) ---


def f1_template(labels: list[str]) -> str:
    """에이전트 설계서 부록 A F-1 (명세서 FR-015 예외 1행 문구)."""
    return f"We need some additional details before we can help: {', '.join(labels)}.\nThank you."


def write_info_request(
    transport: Transport,
    sub_ticket_id: str,
    language: str,
    category_code: str | None,
    product_name: str | None,
    blocking: list[str],
    optional: list[str],
    labels: dict[str, str],
) -> Draft:
    codes = blocking + optional
    schema = {
        "type": "object",
        "properties": {
            "body": {"type": "string"},
            "requested_fields": {"type": "array", "items": {"type": "string", "enum": codes}},
        },
        "required": ["body", "requested_fields"],
    }
    fields = {
        "language_name": LANGUAGE_NAMES.get(language, language),
        "category_name": CATEGORY_NAMES.get(category_code or "", "support"),
        "product_name": product_name or "your product",
        "blocking_items": "\n".join(f"{c} | {labels.get(c, c)}" for c in blocking),
        "optional_items": "\n".join(f"{c} | {labels.get(c, c)}" for c in optional) or "(none)",
    }
    required_labels = [labels.get(c, c) for c in blocking]
    try:
        body = ""
        for _ in range(2):  # 누락 검사: 1회 다시 만든다(FR-015 예외 2행)
            result = generate_json(transport, "L3", L3_PROMPT, fields, schema)
            body = result.data["body"].strip()
            missing = [lab for lab in required_labels if lab not in body]
            if not missing:
                break
        else:
            body += "\n\n" + "\n".join(f"- {lab}" for lab in missing)
        return Draft(sub_ticket_id, "INFO_REQUEST", language, body, requested_fields=codes)
    except LlmError:
        return Draft(sub_ticket_id, "INFO_REQUEST", "en", f1_template(required_labels),
                     requested_fields=codes, flags=[FLAG_AUTO_TRANSLATE_FAILED])


# --- L4 답변 (FR-021) + Q11 자체 대조 ---


@dataclass
class Source:
    doc_id: str
    section_no: str
    title: str
    text: str


def load_skeleton(category_code: str | None) -> str:
    for line in load_prompt(SKELETONS_FILE).splitlines():
        if category_code and line.startswith(category_code + ":"):
            return line.split(":", 1)[1].strip()
    return "Answer only what the sources cover."


REPLY_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "body": {"type": "string"},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"doc_id": {"type": "string"}, "section": {"type": "string"}},
                "required": ["doc_id", "section"],
            },
        },
        "numbers_used": {"type": "array", "items": {"type": "string"}},
        "coverage": {"type": "string", "enum": ["ANSWERED", "PARTIAL", "NOT_IN_SOURCES"]},
    },
    "required": ["body", "citations", "numbers_used", "coverage"],
}
# 코드가 검사하는 스키마: coverage는 없어도 된다(없으면 ANSWERED로 본다, 변경 fix-draft-no-relevant-evidence 결정 1)
REPLY_CHECK_SCHEMA: dict = {**REPLY_SCHEMA, "required": ["body", "citations", "numbers_used"]}
# 근거 후보가 있어도 물은 것에 하나도 답하지 못함 → 근거 없음과 같은 길(FR-016 처리 5, FR-021 처리 2)
COVERAGE_NONE = "NOT_IN_SOURCES"


def write_reply(
    transport: Transport,
    sub_ticket_id: str,
    language: str,
    category_code: str | None,
    evidence_sentences: list[str],
    provided: list[tuple[str, str]],
    lookups: list[tuple[str, Any, str | None, str]],
    sources: list[Source],
    optional_missing_labels: list[str],
    composite: bool = False,
    dept_reply: str = "",
) -> tuple[Draft | None, list[str]]:
    """답변 초안을 만들고 대조한다. (초안 또는 None, 표시 목록).

    composite: 복합 문의면 이 요청의 단락 하나만 쓴다. 인사말·맺음말은 T5가 붙인다(에이전트 설계서 4-6 모드).
    dept_reply: 이관 부서 회신(DEPT_REPLY 재처리 때만). L4 입력과 숫자 허용 목록에 넣는다(§2-4, §3-4 2번, 가-6).
    """
    if not sources:
        return None, [FLAG_NO_EVIDENCE_DRAFT]  # FR-021 처리 2
    optional_line = (
        f"At the end, add one sentence asking the customer to send these if available: "
        f"{', '.join(optional_missing_labels)}."
        if optional_missing_labels else ""
    )
    lookup_lines = [f"{item} | {prompt_value(value, unit)} | {unit or ''} | {source}" for item, value, unit, source in lookups]
    provided_lines = [f"{name} | {value}" for name, value in provided]
    fields = {
        "language_name": LANGUAGE_NAMES.get(language, language),
        "category_name": CATEGORY_NAMES.get(category_code or "", "support"),
        "mode_instruction": MODE_COMPOSITE if composite else MODE_SINGLE,
        "category_skeleton": load_skeleton(category_code),
        "optional_missing_line": optional_line,
        "evidence_sentences": "\n".join(evidence_sentences),
        "provided_fields": "\n".join(provided_lines) or "(none)",
        "lookups": "\n".join(lookup_lines) or "(none)",
        "sources": "\n\n".join(f"[{s.doc_id} §{s.section_no}] {s.title}\n{s.text}" for s in sources),
    }
    if dept_reply:
        fields["dept_reply"] = dept_reply
    sections = {(s.doc_id, s.section_no) for s in sources}
    allowed_texts = ([s.text for s in sources] + [str(v) for _, v, _, _ in lookups]
                     + [v for name, v in provided if name in CHECK_PROVIDED_FIELDS] + ([dept_reply] if dept_reply else []))

    flags: list[str] = []
    body, check, cites = "", CheckResult(False), []
    try:
        for attempt in range(2):  # 대조·길이가 어긋나면 1회 다시 만든다(§3-4 4번, FR-021 예외 4행)
            result = generate_json(transport, "L4", L4_DEPT_PROMPT if dept_reply else L4_PROMPT, fields, REPLY_SCHEMA,
                                   check_schema=REPLY_CHECK_SCHEMA)
            if result.data.get("coverage") == COVERAGE_NONE:  # 다시 만들지 않는다(결정 2)
                return None, [FLAG_NO_EVIDENCE_DRAFT]
            body = result.data["body"].strip()
            cites = result.data["citations"]
            check = check_draft(body, sections, allowed_texts)
            if check.passed and len(body) <= MAX_REPLY_CHARS:
                break
    except LlmError:
        return None, [FLAG_DRAFT_FAILED]
    if not check.passed:
        flags.append(FLAG_CHECK_FAILED)
    if len(body) > MAX_REPLY_CHARS:
        flags.append(FLAG_TOO_LONG)
    draft = Draft(sub_ticket_id, "FINAL_REPLY", language, body, citations=cites,
                  lookups_used=lookups_in_body(body, lookups), check=check.as_dict(), flags=flags,
                  input_fields=list(fields))
    return draft, flags


def prompt_value(value: Any, unit: str | None) -> Any:
    """지시문에 넣는 조회값. 금액은 소수 둘째 자리까지(AC-021-1 "520.00 USD"), 펌웨어 판정은 영어로."""
    if unit == "USD" and isinstance(value, (int, float)):
        return f"{value:.2f}"
    return VERDICT_EN.get(value, value) if isinstance(value, str) else value


def lookups_in_body(body: str, lookups: list[tuple[str, Any, str | None, str]]) -> list[dict[str, Any]]:
    """본문에 값이 나온 조회값만 고른다. 숫자는 값으로, 글은 글자 그대로 찾는다(구현 선택)."""
    body_values = set().union(*(number_values(t) for t in numbers(body))) if numbers(body) else set()
    used = []
    for item, value, unit, source in lookups:
        values = number_values(str(value)) if numbers(str(value)) == [str(value)] else set()
        if (values & body_values) if values else str(value) in body:
            used.append({"item": item, "value": value, "unit": unit, "source": source})
    return used


# --- L7 대역 (FR-039) ---


def write_gloss(transport: Transport, draft: Draft) -> Draft:
    """대역을 붙인다. 초안 언어가 대역 언어와 같으면 만들지 않는다. 실패해도 초안은 그대로다."""
    if draft.language == GLOSS_LANGUAGE:
        return draft
    schema = {"type": "object", "properties": {"gloss": {"type": "string"}}, "required": ["gloss"]}
    fields = {
        "source_language_name": LANGUAGE_NAMES.get(draft.language, draft.language),
        "gloss_language_name": LANGUAGE_NAMES[GLOSS_LANGUAGE],
        "draft_body": draft.body,
    }
    try:
        text, match = "", False
        for _ in range(2):  # 인용·숫자가 다르면 1회 다시(§3-2 L7)
            text = generate_json(transport, "L7", L7_PROMPT, fields, schema).data["gloss"].strip()
            match = same_citations_and_numbers(draft.body, text)
            if match:
                break
    except LlmError:
        draft.flags.append(FLAG_GLOSS_FAILED)
        return draft
    draft.gloss = Gloss(GLOSS_LANGUAGE, text, match)
    if not match:
        draft.flags.append(FLAG_GLOSS_MISMATCH)
    return draft
