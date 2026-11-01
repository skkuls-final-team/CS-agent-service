"""검증 에이전트 완료 기준 (FR-049, 변경 add-verification-agent).

- 대역 Transport 시험: L8 응답을 정해 두고 quote 확인·⑤ 문구·실패 처리를 본다.
- 실제 Gemini 시험: GEMINI_API_KEY가 있을 때만. 초안과 대역은 정해 넣고 L8만 실제로 부른다.
"""

from __future__ import annotations

import pytest

from app.config import get_settings
from app.llm.client import LlmTimeout, default_transport
from app.llm.drafts import Draft, Gloss, Source
from app.llm.verify import verify_draft
from app.pipeline.graph import run_ticket
from tests.acceptance.test_drafts import (  # noqa: F401  (index 픽스처를 함께 쓴다)
    GLOSS_OK, L2_QUOTE, QUOTE_BODY, FakeTransport, WordCountEmbedder, index, l1, ticket_input,
)

DISCOUNT = "Nous vous accordons une remise de 30 % sur cette commande."
DISCOUNT_BODY = QUOTE_BODY + " " + DISCOUNT
DISCOUNT_GLOSS = {"gloss": GLOSS_OK["gloss"] + " 이번 주문에 30 % 할인을 드립니다."}


def l4(body):
    return {"body": body, "citations": [], "numbers_used": []}


def promise(quote=DISCOUNT):
    return {"findings": [{"kind": "PROMISE", "quote": quote, "reason": "근거에 없는 할인 약속"}]}


def run(conn, **replies):
    fake = FakeTransport(L1=[l1("QUOTE", "fr")], L2=[L2_QUOTE], **replies)
    return fake, run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))


def test_ac_049_1_discount_is_promise(conn, index):
    """AC-049-1: 근거에 없는 "30% 할인" — 코드 검사는 통과, ⑤ "걸림: 약속 표현", 그 문장이 quote로 남는다."""
    fake, out = run(conn, L4=[l4(DISCOUNT_BODY)], L7=[DISCOUNT_GLOSS], L8=[promise()])
    (draft,) = out.drafts
    assert draft.check["passed"], draft.check  # 30은 POL-ORDER §5의 "30일"과 같아 코드 검사 통과
    assert draft.verify.mark() == "⑤ 걸림: 약속 표현" and draft.verify.state == "FOUND"
    assert draft.verify.by_kind()["PROMISE"] == "문제 있음" and draft.verify.by_kind()["OFF_TOPIC"] == "문제 없음"
    assert [f.quote for f in draft.verify.findings] == [DISCOUNT]
    assert out.state.sub_tickets[0].verify_findings == draft.verify.findings
    assert draft.message_status == "DRAFT" and draft.body == DISCOUNT_BODY  # 고치지도 막지도 않는다
    l8_prompt = next(p for c, p in fake.prompts if c == "L8")
    assert "<customer_message>" in l8_prompt and "[POL-ORDER §5]" in l8_prompt and "<gloss>단가" in l8_prompt


def test_ac_049_4_timeout_twice(conn, index):
    """AC-049-4: L8 두 번 시간 초과 → 초안은 DRAFT로 남고 ⑤ 검증 못 함(실패), 오류 LLM_TIMEOUT."""
    fake, out = run(conn, L4=[l4(QUOTE_BODY)], L7=[GLOSS_OK], L8=[LlmTimeout("t")])
    (draft,) = out.drafts
    assert fake.count("L8") == 2 and out.run_status == "SUCCESS"
    assert draft.message_status == "DRAFT" and draft.check["passed"]
    assert not draft.verify.passed_yn and draft.verify.state == "FAILED"
    assert draft.verify.mark() == "⑤ 검증 못 함(실패)"
    assert draft.verify.detail() == {"error": "LLM_TIMEOUT"}
    assert out.state.sub_tickets[0].verify_findings is None


def test_ac_049_5_gloss_mistranslation(conn, index):
    """AC-049-5: 초안과 뜻이 다른 대역 → ⑤ "걸림: 대역 오역"."""
    wrong = "유효기간 90일"
    gloss = {"gloss": GLOSS_OK["gloss"].replace("유효기간 30일", wrong)}
    finding = {"findings": [{"kind": "GLOSS_MISTRANSLATION", "quote": wrong, "reason": "원문은 30일"}]}
    _, out = run(conn, L4=[l4(QUOTE_BODY)], L7=[gloss, gloss], L8=[finding])
    (draft,) = out.drafts
    assert draft.verify.mark() == "⑤ 걸림: 대역 오역"


def test_ac_049_6_l8_input_is_masked(conn, index):
    """AC-049-6: 검증 호출 입력에 가려지지 않은 이메일·전화번호가 없다."""
    email, phone = "jean.dupont@example.fr", "+33 6 12 34 56 78"
    body = QUOTE_BODY + f" Contact : {email}, {phone}."
    fake = FakeTransport(L1=[{**l1("QUOTE", "fr"), "sub_tickets": [{**l1("QUOTE", "fr")["sub_tickets"][0],
                                                                      "evidence_sentences": [f"Écrivez à {email}"]}]}],
                         L2=[L2_QUOTE], L4=[l4(body)], L7=[GLOSS_OK], L8=[{"findings": []}])
    run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000004"))
    l8_prompt = next(p for c, p in fake.prompts if c == "L8")
    assert email not in l8_prompt and "12 34 56 78" not in l8_prompt


def test_made_up_quote_is_dropped(conn, index):
    """§3-2 L8: quote가 초안·대역에 없으면 그 지적만 버린다 → ⑤ 통과."""
    _, out = run(conn, L4=[l4(QUOTE_BODY)], L7=[GLOSS_OK], L8=[promise("Livraison garantie demain.")])
    (draft,) = out.drafts
    assert draft.verify.findings == [] and draft.verify.mark() == "⑤ 통과"
    assert draft.verify.detail() == {"findings": [], "gloss_checked": True}


# 복합 문의 CSV1-000008의 펌웨어 답변 메일 (compose_mail 모양: 인사말 · 단락 · 상태 목록 · 맺음말을 빈 줄로 잇는다)
FW_SENTENCE = "Your firmware 3.40 is already the latest version (RN-ESS-BMS-V3 §1)."
STATUS_LIST = ("Status of your requests:\n1. Firmware update: answered in this email.\n"
               "2. Manual and document: we are still working on this.")
COMPOUND_MAIL = "\n\n".join(["مرحبا،", FW_SENTENCE, STATUS_LIST, "مع التحية."])


def verify_compound(findings):
    fake = FakeTransport(L8=[{"findings": findings}])
    draft = Draft("CSV1-000008-1", "FINAL_REPLY", "ar", COMPOUND_MAIL, gloss=Gloss("ko", "펌웨어 3.40은 이미 최신입니다."))
    return verify_draft(fake, draft, ["هل يوجد إصدار أحدث من البرنامج الثابت؟"], [], [])


def test_ac_049_7_status_list_is_not_off_topic():
    """제안 AC-049-7 (변경 fix-verify-status-list): 상태 목록 줄을 질문과 다름으로 지적해도 버린다 → ⑤ 통과."""
    result = verify_compound([{"kind": "OFF_TOPIC", "quote": "2. Manual and document: we are still working on this.",
                               "reason": "고객이 묻지 않은 매뉴얼"}])
    assert result.findings == [] and result.mark() == "⑤ 통과"


def test_status_list_quote_with_spaces_is_dropped():
    """상태 목록 여러 줄을 공백으로 이은 quote도 버린다(L8은 줄바꿈을 공백으로 바꿔 내기도 한다)."""
    quote = " ".join(STATUS_LIST.split("\n"))
    assert verify_compound([{"kind": "OFF_TOPIC", "quote": quote, "reason": "x"}]).findings == []


def test_paragraph_finding_in_compound_mail_is_kept():
    """제안 AC-049-7: 같은 메일이라도 단락 문장의 지적은 그대로 남는다."""
    result = verify_compound([{"kind": "PROMISE", "quote": FW_SENTENCE, "reason": "x"},
                              {"kind": "OFF_TOPIC", "quote": "Status of your requests:", "reason": "x"}])
    assert [f.quote for f in result.findings] == [FW_SENTENCE] and result.mark() == "⑤ 걸림: 약속 표현"


def test_no_gloss_skips_gloss_kind(conn, index):
    """FR-049 예외 3행: 대역이 없으면 ④를 빼고 검증, gloss_checked = false, 꼬리말."""
    finding = {"findings": [{"kind": "GLOSS_MISTRANSLATION", "quote": "Offre valable 30 jours", "reason": "x"}]}
    _, out = run(conn, L4=[l4(QUOTE_BODY)], L7=[LlmTimeout("t")], L8=[finding])
    (draft,) = out.drafts
    assert draft.gloss is None and draft.verify.findings == []
    assert draft.verify.detail()["gloss_checked"] is False
    assert draft.verify.mark() == "⑤ 통과 (대역 없음: ④ 확인 못 함)"
    assert draft.verify.by_kind()["GLOSS_MISTRANSLATION"] == "확인 못 함"


def test_info_request_is_verified(conn, index):
    """§3-1 L8 행: 정보 요청 초안도 검증한다."""
    from tests.acceptance.test_drafts import L2_DEFECT
    fake = FakeTransport(L1=[l1("DEFECT", "en")], L2=[L2_DEFECT],
                         L3=[{"body": "Please send the Serial number (nameplate).", "requested_fields": ["serial_no"]}])
    out = run_ticket(conn, fake, WordCountEmbedder(), ticket_input(conn, "CSV1-000017"))
    (draft,) = out.drafts
    assert draft.message_type == "INFO_REQUEST" and draft.verify.mark().startswith("⑤ 통과")
    assert fake.count("L8") == 1


needs_key = pytest.mark.skipif(not get_settings().gemini_api_key, reason="키 없음: GEMINI_API_KEY가 없어 언어 모델 시험을 건너뜀")

POL_ORDER_5 = Source("POL-ORDER", "5", "Quotation validity", "Quotations are valid for 30 days from the date of issue.")


@needs_key
def test_ac_049_1_live():
    draft = Draft("CSV1-000004-1", "FINAL_REPLY", "fr", DISCOUNT_BODY.replace("(POL-ORDER §1)", ""),
                  gloss=Gloss("ko", DISCOUNT_GLOSS["gloss"]))
    result = verify_draft(default_transport(), draft, ["Pouvez-vous m'envoyer un devis pour 1 HMI-XGT-eXP60 ?"],
                          [POL_ORDER_5], [("list_price_usd", 520, "USD", "product_master.csv:HMI-XGT-eXP60"),
                                          ("std_lead_time_weeks", 4, "week", "product_master.csv:HMI-XGT-eXP60")])
    assert result.error is None and "약속 표현" in result.mark()


@needs_key
def test_ac_049_5_live():
    body = "Offre valable 30 jours (POL-ORDER §5)."
    draft = Draft("CSV1-000004-1", "FINAL_REPLY", "fr", body, gloss=Gloss("ko", "견적은 90일 동안 유효합니다 (POL-ORDER §5)."))
    result = verify_draft(default_transport(), draft, ["Combien de temps le devis est-il valable ?"], [POL_ORDER_5], [])
    assert result.error is None and "대역 오역" in result.mark()
