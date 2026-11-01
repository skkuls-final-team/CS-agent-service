// SCR-03 초안 영역 시험 (B 담당 새 파일, 분담표 v3). 실제 API·실제 Gemini로 새 문의를 접수한다.
// 변경 fix-draft-no-relevant-evidence: 근거 후보가 있어도 질문에 답하지 못하면 답변 초안을 만들지 않는다(FR-021 처리 2, FR-016 처리 5).
import { expect, test } from "@playwright/test";
import { api, useSession } from "./session";
import { H, waitDone } from "./ticket";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// CSV1-000004의 고객·제품(HMI-XGT-eXP60)으로 문서에 답이 없는 도장 색 질문(팀 정답지 GS-065와 같은 경우, 정답지 본문은 쓰지 않음)
const RAL_BODY = "Bonjour,\n\nPouvez-vous livrer le boîtier du XGT Panel eXP60 peint en RAL 9005 au lieu de votre couleur standard ?\n\n"
  + "Détails :\n- Modèle du produit / référence de commande: HMI-XGT-eXP60\n\nMerci.";

test.describe.serial("근거 후보는 있는데 질문에 답하지 못하는 문의", () => {
  test.setTimeout(300_000);
  let id = "";
  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    const g = await (await request.get(api("/gold/tickets/CSV1-000004"))).json();
    const res = await request.post(api("/tickets"), {
      headers: H("SALES_OPS"),
      data: { channel: g.channel, customer_id: g.customer_id, product_code: g.product_code, language: g.language,
              inquiry_subject: null, inquiry_body: RAL_BODY, received_at_utc: null, source_ticket_id: null,
              contact_name: null, contact_email: null, contact_phone: null },
    });
    expect(res.ok()).toBeTruthy();
    id = (await res.json()).ticket_id;
    await waitDone(request, id, "SALES_OPS");
  });

  test("제안 AC-021-6: 답변 초안이 없고 '근거 없음 — 상담원 작성 필요'와 빈 편집기가 보인다. 근거 후보는 남는다", async ({ page, request }) => {
    const d: Json = await (await request.get(api(`/tickets/${id}`), { headers: H("SALES_OPS") })).json();
    const sub = d.sub_tickets[0];
    expect(sub.sub_ticket.missing_blocking_info).toEqual([]);
    expect(sub.sub_ticket.evidence_json.length).toBeGreaterThan(0);
    expect(sub.drafts.filter((x: Json) => x.message_type === "FINAL_REPLY")).toEqual([]);
    expect(sub.checks.map((c: Json) => c.check_type)).toContain("NO_EVIDENCE");

    await useSession(page, { dept: sub.sub_ticket.assigned_dept, agent: "leo" });
    await page.goto(`/tickets/${id}`);
    await page.getByRole("tab", { name: /^답변/ }).click();
    await expect(page.getByTestId("no-draft")).toContainText("근거 없음 — 상담원 작성 필요");
    const editor = page.getByRole("textbox", { name: "직접 쓰는 답변" });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue("");
  });
});
