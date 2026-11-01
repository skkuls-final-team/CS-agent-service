"""초안 만들기 완료 기준 (FR-015·021·039, 변경 add-drafts).

- 대역 Transport 시험: 호출마다 정해진 응답을 내서 분기·대조·실패 처리를 본다.
- 실제 Gemini 시험: GEMINI_API_KEY가 있을 때만. 검색은 대역 임베딩 색인을 쓴다.
"""

from __future__ import annotations

import hashlib
import json
import math
import re

import pytest

from app.checks.draft_check import check_draft, dates, numbers, same_citations_and_numbers
from app.config import get_settings
from app.llm.client import LlmTimeout, default_transport
from app.pipeline.graph import run_ticket
from jobs.build_doc_index import build

DIM = 64


class WordCountEmbedder:
    def __init__(self, fail_times: int = 0):
        self.fail_times, self.calls = fail_times, 0

    def embed(self, texts, task):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise LlmTimeout("t")
        out = []
        for text in texts:
            v = [0.0] * DIM
            for word in re.findall(r"[a-z0-9.]+", text.lower()):
                v[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIM] += 1.0
            norm = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / norm + 1e-6 for x in v])
        return out


CALLS = {"L1": "You read one", "L2": "You extract", "L3": "Write a short email", "L4": "Write a reply", "L5": "Write a greeting",
         "L7": "Translate the email", "L8": "You review a draft",
         "L12": "Translate the customer message"}
NO_FINDINGS = {"findings": []}


class FakeTransport:
    """호출별로 정해진 응답을 차례로 낸다(마지막 응답은 계속 반복). 받은 지시문을 남긴다."""

    def __init__(self, **replies):
        self.queues = {k: list(v) for k, v in replies.items()}
        self.prompts: list[tuple[str, str]] = []

    def send(self, prompt, schema):
        call = next(k for k, start in CALLS.items() if prompt.startswith(start))
        self.prompts.append((call, prompt))
        q = self.queues.setdefault(call, [NO_FINDINGS]) if call == "L8" else self.queues[call]
        reply = q.pop(0) if len(q) > 1 else q[0]
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)

    def count(self, call):
        return sum(c == call for c, _ in self.prompts)


@pytest.fixture(scope="module")
def index(conn):
    build(conn, get_settings().data_path, WordCountEmbedder())
    conn.commit()


def ticket_input(conn, ticket_id):
    cur = conn.execute("SELECT * FROM gold.v_inputs WHERE ticket_id = %s", (ticket_id,))
    return dict(zip([d.name for d in cur.description], cur.fetchone()))


def l1(category, lang, urgency="NONE", query="q"):
    return {"body_language": lang, "body_language_confidence": 0.95, "sub_tickets": [{
        "seq": 1, "category_code": category, "category_confidence": 0.9, "evidence_sentences": ["s1"],
        "urgency_flag": urgency, "urgency_evidence": None, "query_en": query}]}


def field(name, value):
    return {"field": name, "value_raw": value, "value_norm": value, "span": [0, 0]}


L2_DEFECT = {"fields": [field("product_model", "ACB-AS-2000"), field("error_code", "overheating")]}
L2_QUOTE = {"fields": [field("product_model", "HMI-XGT-eXP60"), field("quantity", "1"),
                       field("incoterms", "CIF Le Havre"), field("required_date", "2025-10-28")]}
QUOTE_BODY = ("Prix unitaire : 520,00 USD, total 520,00 USD pour 1 unité, délai standard 4 semaines (POL-ORDER §1). "
              "Offre valable 30 jours (POL-ORDER §5). Un commercial vous enverra un devis précis.")
GLOSS_OK = {"gloss": "단가 520,00 USD, 합계 520,00 USD, 1개, 표준 납기 4주 (POL-ORDER §1). 유효기간 30일 (POL-ORDER §5). 영업 담당이 정확한 견적을 안내합니다."}


# --- FR-015 정보 요청 ---


def test_ac_015_1_info_request_mail(conn, index):
    """AC-015-1 (대역): 막는 항목 serial_no → 영어 INFO_REQUEST DRAFT, 본문에 "Serial number (nameplate)"."""
    fake = FakeTransport(
        L1=[l1("DEFECT", "en", "SAFETY")], L2=[L2_DEFECT],
        L3=[{"body": "Dear Customer,\nPlease send: serial number (Serial number (nameplate)).\nThank you.",
             "requested_fields": ["serial_no"]}],
        L7=[{"gloss": "고객님, 제조번호(Serial number (nameplate))를 보내 주세요. 감사합니다."}],
    )
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000017"))
    assert out.run_status == "SUCCESS"
    sub = out.state.sub_tickets[0]
    assert sub.missing_blocking_info == ["serial_no"]
    assert sub.priority_final and sub.assigned_dept and sub.sla_id
    (draft,) = out.drafts
    assert (draft.message_type, draft.message_status, draft.sender, draft.language) == \
        ("INFO_REQUEST", "DRAFT", "SYSTEM", "en")
    assert "Serial number (nameplate)" in draft.body
    assert draft.gloss and draft.gloss.language == "ko"
    assert fake.count("L4") == 0  # 분기③: 정보 요청만


def test_info_request_missing_label_appended(conn, index):
    """FR-015 예외 2행: 라벨이 두 번 모두 빠지면 본문 끝에 목록으로 덧붙인다."""
    fake = FakeTransport(L1=[l1("DEFECT", "en")], L2=[L2_DEFECT],
                         L3=[{"body": "Please send more details.", "requested_fields": []}], L7=[{"gloss": "자세히"}])
    (draft,) = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000017")).drafts
    assert fake.count("L3") == 2
    assert draft.body.endswith("- Serial number (nameplate)")


def test_info_request_f1_when_llm_fails(conn, index):
    """FR-015 예외 1행: L3 두 번 실패 → 영어 F-1 + "자동 번역 실패"."""
    fake = FakeTransport(L1=[l1("DEFECT", "en")], L2=[L2_DEFECT], L3=["not json"], L7=[{"gloss": "x"}])
    (draft,) = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000017")).drafts
    assert draft.language == "en" and "자동 번역 실패" in draft.flags
    assert draft.body.startswith("We need some additional details before we can help: Serial number (nameplate).")


def test_ac_015_3_no_blocking_no_info_request(conn, index):
    """AC-015-3: 막는 항목이 없는 CSV1-000004 → INFO_REQUEST 없음(답변 초안으로 감)."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr", "DEADLINE", "price quotation")], L2=[L2_QUOTE],
                         L4=[{"body": QUOTE_BODY, "citations": [], "numbers_used": []}], L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    assert out.state.sub_tickets[0].missing_blocking_info == []
    assert [d.message_type for d in out.drafts] == ["FINAL_REPLY"]
    assert fake.count("L3") == 0


# --- FR-021 답변 초안 ---


def test_reply_draft_passes_check(conn, index):
    """FR-021 처리 3·5: 근거 절과 조회값만 쓴 초안은 대조를 통과하고 FINAL_REPLY DRAFT가 된다."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr", "DEADLINE", "price quotation")], L2=[L2_QUOTE],
                         L4=[{"body": QUOTE_BODY, "citations": [], "numbers_used": []}], L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    (draft,) = out.drafts
    assert draft.message_status == "DRAFT" and draft.language == "fr"
    assert draft.check["passed"], draft.check
    assert out.state.sub_tickets[0].draft_check == draft.check
    l4_prompt = next(p for c, p in fake.prompts if c == "L4")
    assert "product_master.csv:HMI-XGT-eXP60" in l4_prompt and "[POL-ORDER §5]" in l4_prompt
    assert "<customer_message>" in l4_prompt
    assert fake.count("L4") == 1
    used = {u["item"]: u for u in draft.lookups_used}  # FR-021 출력 "사용한 조회값 목록"
    assert used["list_price_usd"]["source"].startswith("product_master.csv:")
    assert draft.gloss.made_at is not None  # §2-2 Q13 made_at


def test_ac_021_3_no_evidence_no_draft(conn, index):
    """AC-021-3: 근거 후보가 비면 초안 없음 + "근거 없음 — 상담원 작성 필요"."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], L4=[{"body": "x", "citations": [], "numbers_used": []}],
                         L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(fail_times=99), ticket_input(conn, "CSV1-000004"))
    assert out.drafts == [] and fake.count("L4") == 0
    assert "근거 없음 — 상담원 작성 필요" in out.state.sub_tickets[0].flags


def test_ac_021_6_sources_do_not_answer_no_draft(conn, index):
    """제안 AC-021-6 (변경 fix-draft-no-relevant-evidence): 후보가 있어도 L4가 NOT_IN_SOURCES → 초안 없음, 다시 만들지 않음."""
    fake = FakeTransport(L1=[l1("TECH_SPEC", "fr", query="enclosure paint colour RAL 9005")], L2=[L2_QUOTE],
                         L4=[{"body": "Notre équipe va vérifier.", "citations": [], "numbers_used": [],
                              "coverage": "NOT_IN_SOURCES"}], L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    sub = out.state.sub_tickets[0]
    assert out.drafts == [] and fake.count("L4") == 1
    assert "근거 없음 — 상담원 작성 필요" in sub.flags
    assert sub.doc_candidates  # 근거 후보 목록은 그대로 남는다
    assert "Set coverage." in next(p for c, p in fake.prompts if c == "L4")


def test_ac_021_7_partial_keeps_draft(conn, index):
    """제안 AC-021-7: L4가 PARTIAL이면 초안을 둔다."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr", "DEADLINE", "price quotation")], L2=[L2_QUOTE],
                         L4=[{"body": QUOTE_BODY, "citations": [], "numbers_used": [], "coverage": "PARTIAL"}],
                         L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    (draft,) = out.drafts
    assert draft.message_type == "FINAL_REPLY" and "근거 없음 — 상담원 작성 필요" not in out.state.sub_tickets[0].flags


class CoverageByCategory(FakeTransport):
    """L4만 지시문의 유형 이름으로 응답을 고른다(복합 문의의 하위 문의 처리 순서와 상관없게)."""

    def __init__(self, l4_by_category, **replies):
        super().__init__(**replies)
        self.l4_by_category = l4_by_category

    def send(self, prompt, schema):
        if prompt.startswith(CALLS["L4"]):
            self.prompts.append(("L4", prompt))
            reply = next(r for name, r in self.l4_by_category.items() if f"customer's {name} request" in prompt)
            return json.dumps(reply, ensure_ascii=False)
        return super().send(prompt, schema)


def test_ac_021_8_compound_one_sub_not_answered(conn, index):
    """제안 AC-021-8: 복합 문의에서 매뉴얼 문의만 NOT_IN_SOURCES → 그 문의는 초안 없음, 펌웨어 메일 상태 목록에 "담당자 확인 중"."""
    def request(seq, category, query):
        return {"seq": seq, "category_code": category, "category_confidence": 0.9, "evidence_sentences": [f"s{seq}"],
                "urgency_flag": "NONE", "urgency_evidence": None, "query_en": query}

    fw_body = "Your firmware is already the latest version (RN-ESS-BMS-V3 §1)."
    fake = CoverageByCategory(
        {"firmware update": {"body": fw_body, "citations": [], "numbers_used": [], "coverage": "ANSWERED"},
         "manual and document": {"body": "x", "citations": [], "numbers_used": [], "coverage": "NOT_IN_SOURCES"}},
        L1=[{"body_language": "ar", "body_language_confidence": 0.95, "sub_tickets": [
            request(1, "FW_UPDATE", "latest firmware ESS BMS Controller V3 release notes"),
            request(2, "MANUAL", "ESS BMS Controller V3 manual datasheet document")]}],
        L2=[{"fields": [field("product_model", "ESS-BMS-V3"), field("current_fw", "3.40")]}],
        L5=[{"greeting": "مرحبا،", "closing": "مع التحية."}], L7=[{"gloss": "대역"}])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000008"))
    by_seq = {s.seq: s for s in out.state.sub_tickets}
    assert [d.sub_ticket_id for d in out.drafts] == [by_seq[1].sub_ticket_id]
    assert "근거 없음 — 상담원 작성 필요" in by_seq[2].flags
    assert "2. Manual and document: a member of our team is checking this." in out.drafts[0].body


def test_ac_017_5_check_failure_twice_keeps_draft(conn, index):
    """AC-017-5, §3-4 4번: 근거 밖 인용·숫자가 두 번 → 초안은 두고 어긋난 자리를 남긴다."""
    bad = {"body": "Remise de 15 % (POL-RETURN §2).", "citations": [], "numbers_used": []}
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], L4=[bad], L7=[{"gloss": "15% 할인 (POL-RETURN §2)."}])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    (draft,) = out.drafts
    assert fake.count("L4") == 2
    assert not draft.check["passed"]
    assert draft.check["bad_citations"] == ["(POL-RETURN §2)"] and draft.check["bad_numbers"] == ["15"]
    assert "인용·숫자 불일치" in draft.flags


def test_reply_too_long_flag(conn, index):
    """FR-021 예외 4행: 1,500자를 넘으면 1회 다시, 그래도 길면 초안을 두고 "초안 길이 초과"."""
    long_body = {"body": QUOTE_BODY + " " + "Merci." * 300, "citations": [], "numbers_used": []}
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], L4=[long_body], L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    (draft,) = out.drafts
    assert fake.count("L4") == 2 and "초안 길이 초과" in draft.flags


def test_ac_038_4_masked_company_stays_masked(conn, index):
    """AC-038-4: 초안에 고객사 이름이 들어가면 가린 값 그대로이고 되돌린 이름이 없다."""
    data = ticket_input(conn, "CSV1-000004")
    data["inquiry_body"] = data["inquiry_body"] + "\nCOMPANY_4975_0183"
    body = "COMPANY_4975_0183, " + QUOTE_BODY
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], L4=[{"body": body, "citations": [], "numbers_used": []}],
                         L7=[GLOSS_OK | {"gloss": "COMPANY_4975_0183, " + GLOSS_OK["gloss"]}])
    out = run_ticket(conn, fake, WordCountEmbedder(), data)
    (draft,) = out.drafts
    assert "COMPANY_4975_0183" in draft.body and "COMPANY_4975_0183" in draft.gloss.body
    assert draft.check["passed"], draft.check  # 가린 값의 숫자는 하이픈·밑줄에 붙어 숫자로 세지 않는다


def test_reply_llm_failure(conn, index):
    """FR-021 예외 1행: L4 두 번 실패 → 초안 없음 + "초안 생성 실패. 다시 시도"."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], L4=[LlmTimeout("t")], L7=[GLOSS_OK])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    assert out.drafts == [] and "초안 생성 실패. 다시 시도" in out.state.sub_tickets[0].flags


def test_unknown_customer_fails_run(conn, index):
    """§2-2 Q2: 고객 기준정보가 없으면 실행 FAILED(VALIDATION)."""
    data = ticket_input(conn, "CSV1-000004") | {"customer_id": "NO-SUCH"}
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], L4=["x"], L7=["x"])
    out = run_ticket(conn, fake, WordCountEmbedder(), data)
    assert out.run_status == "FAILED" and out.error_type == "VALIDATION" and out.drafts == []


# --- FR-039 대역 ---


def test_ac_039_3_gloss_failure_keeps_draft(conn, index):
    """AC-039-3: 번역 실패 → "대역 없음(번역 실패)", 초안은 DRAFT로 남는다."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE],
                         L4=[{"body": QUOTE_BODY, "citations": [], "numbers_used": []}], L7=[LlmTimeout("t")])
    (draft,) = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004")).drafts
    assert draft.gloss is None and "대역 없음(번역 실패)" in draft.flags
    assert draft.message_status == "DRAFT" and draft.body == QUOTE_BODY


def test_gloss_numbers_mismatch_flag(conn, index):
    """§3-2 L7: 대역의 숫자가 두 번 다르면 numbers_match = false + "인용·숫자 확인"."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE],
                         L4=[{"body": QUOTE_BODY, "citations": [], "numbers_used": []}],
                         L7=[{"gloss": "단가 500 USD (POL-ORDER §1)."}])
    (draft,) = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004")).drafts
    assert fake.count("L7") == 2
    assert draft.gloss and not draft.gloss.numbers_match and "인용·숫자 확인" in draft.flags


def test_gloss_keeps_numbers_and_citations(conn, index):
    """AC-039-1 (대역): 대역의 숫자·인용이 원문과 같으면 numbers_match = true."""
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE],
                         L4=[{"body": QUOTE_BODY, "citations": [], "numbers_used": []}], L7=[GLOSS_OK])
    (draft,) = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004")).drafts
    assert draft.gloss.numbers_match and fake.count("L7") == 1


# --- 자체 대조 단위 ---


def test_draft_check_reads_locale_numbers():
    sections = {("POL-ORDER", "5")}
    allowed = ["520", "1", "Quotations are valid for 30 days."]
    assert check_draft("٥٢٠ USD et 520,00 USD, 30 jours (POL-ORDER §5).", sections, allowed).passed
    assert numbers("modèle HMI-XGT-eXP60 v3.40") == ["3.40"]
    r = check_draft("Livraison le 12 (DS-X §9).", sections, allowed)
    assert r.bad_numbers == ["12"] and r.bad_citations == ["(DS-X §9)"]


def test_draft_check_dates():
    """§3-4 2번: 날짜는 연·월·일을 함께 비교한다. 제공 항목의 날짜는 통과, 다른 날짜는 어긋남."""
    assert dates("le 28/10/2025")[0][0] == "28/10/2025"
    assert check_draft("Livraison le 28/10/2025.", set(), ["2025-10-28"]).passed
    assert check_draft("Livraison le 2025-11-28.", set(), ["2025-10-28"]).bad_numbers == ["2025-11-28"]


def test_same_citations_and_numbers():
    assert same_citations_and_numbers("520,00 USD (POL-ORDER §5)", "520,00 USD (POL-ORDER §5) 입니다")
    assert not same_citations_and_numbers("520 USD (POL-ORDER §5)", "520 USD")


# --- 실제 Gemini (키가 있을 때만, 검색은 대역 임베딩) ---

needs_key = pytest.mark.skipif(not get_settings().gemini_api_key, reason="키 없음: GEMINI_API_KEY가 없어 언어 모델 시험을 건너뜀")


@pytest.fixture(scope="module")
def live(conn, index):
    transport, cache = default_transport(), {}

    def run(ticket_id):
        if ticket_id not in cache:
            cache[ticket_id] = run_ticket(conn, transport, WordCountEmbedder(), ticket_input(conn, ticket_id))
        return cache[ticket_id]

    return run


@needs_key
def test_ac_015_1_live(live):
    drafts = live("CSV1-000017").drafts
    assert drafts[0].message_type == "INFO_REQUEST" and drafts[0].language == "en"
    assert "Serial number (nameplate)" in drafts[0].body


@needs_key
def test_ac_015_2_live(live):
    (draft,) = live("CSV1-003578").drafts
    assert draft.message_type == "INFO_REQUEST" and draft.language == "it"
    assert any(lab in draft.body for lab in ["Serial number (nameplate)", "Product model / ordering code"])


@needs_key
def test_ac_021_1_live(live):
    (draft,) = live("CSV1-000004").drafts
    assert draft.message_type == "FINAL_REPLY" and draft.language == "fr"
    assert re.search(r"520[.,]00", draft.body) and "30" in draft.body
    assert "4 semaines" in draft.body or "quatre semaines" in draft.body
    assert draft.check["passed"]
    assert any(u["source"].startswith("product_master.csv:") for u in draft.lookups_used)


@needs_key
def test_ac_021_2_live(live):
    # 2순위부터 000008은 복합 문의(FW_UPDATE + MANUAL)로 나뉜다(add-compound-inquiry). 펌웨어 하위 문의의 메일을 본다.
    # 단락 모드에서 인용을 빼고 쓴 적이 있다(C-94)
    draft = next(d for d in live("CSV1-000008").drafts if d.sub_ticket_id == "CSV1-000008-1")
    assert draft.language == "ar" and "RN-ESS-BMS-V3" in draft.body and "3.50" not in draft.body
    assert "최신" in draft.gloss.body  # "이미 최신" 취지는 한국어 대역으로 확인한다


@needs_key
def test_ac_021_6_live(conn, index):
    """제안 AC-021-6 (실제 Gemini): CSV1-000004의 고객·제품으로 문서에 답이 없는 도장 색 질문 → 초안 없음.
    팀 정답지 GS-065와 같은 경우지만 정답지 본문은 저장소에 넣지 않으므로 시험용 문장을 쓴다."""
    ticket = ticket_input(conn, "CSV1-000004")
    ticket["inquiry_body"] = ("Bonjour,\n\nPouvez-vous livrer le boîtier du XGT Panel eXP60 peint en RAL 9005 "
                              "au lieu de votre couleur standard ?\n\nDétails :\n"
                              "- Modèle du produit / référence de commande: HMI-XGT-eXP60\n\nMerci.")
    out = run_ticket(conn, default_transport(), WordCountEmbedder(), ticket)
    sub = out.state.sub_tickets[0]
    assert not sub.missing_blocking_info and sub.doc_candidates
    assert [d for d in out.drafts if d.message_type == "FINAL_REPLY"] == []
    assert "근거 없음 — 상담원 작성 필요" in sub.flags


@needs_key
def test_ac_039_1_live(live):
    (draft,) = live("CSV1-000004").drafts
    assert draft.gloss and draft.gloss.numbers_match
