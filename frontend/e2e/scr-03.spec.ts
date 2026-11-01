// SCR-03 티켓 상세 수용 기준 (docs/frontend/screens/SCR-03-ticket-detail.md). 실제 API, 실패·빈 상태만 page.route로 만든다.
// 화면 시험은 "화면이 API 값을 그대로 보이는가"를 본다. 파이프라인 값이 정답지와 다른 곳은 슬라이스 문서 "정답지와 다른 값"에 적었다.
// 상태를 바꾸는 시험은 새로 접수한 사본에서 한다(e2e/ticket.ts). 시연 티켓 CSV1-004001~004009는 읽기만 한다.
import { expect, test, type Page } from "@playwright/test";
import { api, useSession } from "./session";
import { H, intakeCopy, waitDone } from "./ticket";

const DEMO_17 = "CSV1-004004"; // 원본 CSV1-000017
const DEMO_08 = "CSV1-004003"; // 원본 CSV1-000008 (복합 2건)
const DEMO_04 = "CSV1-004001"; // 원본 CSV1-000004 (프랑스어 견적)
const DEMO_07 = "CSV1-004002"; // 원본 CSV1-000007 (답변 초안 있음)

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const row = (page: Page, seq: number, id: string) => page.getByTestId(`judge-${seq}`).locator(`[data-row="${id}"]`);
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const dialog = (page: Page, title: string | RegExp) => page.getByRole("dialog", { name: title });

/** 상세 응답 하나를 고쳐 돌려준다(실패·빈 상태 전용) */
async function mockDetail(page: Page, id: string, edit: (d: Json) => void) {
  await page.route(new RegExp(`/api/tickets/${id}(\\?.*)?$`), async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    edit(body);
    await route.fulfill({ response: res, json: body });
  });
}

async function detail(request: import("@playwright/test").APIRequestContext, id: string, dept = "TS_LV"): Promise<Json> {
  return (await request.get(api(`/tickets/${id}`), { headers: H(dept) })).json();
}

test.describe("시연 티켓 읽기", () => {
  test.beforeEach(async ({ page }) => useSession(page, { dept: "TS_LV", agent: "leo" }));

  test("SCR-03-AC-1: 000017 사본 — ① 뽑은 값 강조, ② 유형·긴급도·우선순위·부서·SLA·막는 항목이 API 값, ③ 영어 정보 요청 초안", async ({ page, request }) => {
    const d = await detail(request, DEMO_17);
    const st = d.sub_tickets[0].sub_ticket;
    await page.goto(`/tickets/${DEMO_17}?tab=customer`);
    const marks = page.getByTestId("inquiry-body").locator("mark");
    await expect(marks.first()).toBeVisible();
    await expect(marks.filter({ hasText: "ACB-AS-2000" })).toHaveCount(1);

    await page.getByRole("tab", { name: "판단과 근거" }).click(); // 오른쪽 칸은 탭으로 바꿔 본다(add-ticket-detail-layout)
    await expect(row(page, 1, "C-01")).toContainText(st.category_code);
    await expect(row(page, 1, "C-02")).toContainText(st.urgency_flag);
    await expect(row(page, 1, "C-03")).toContainText(st.priority);
    await expect(row(page, 1, "C-03")).toContainText(`(${st.priority_rule_id})`);
    await expect(row(page, 1, "C-04")).toContainText(st.assigned_dept);
    const sla = d.sub_tickets[0].sla;
    await expect(row(page, 1, "C-06")).toContainText(`1차 응답 ${sla.fr_target_h}h / 해결 ${sla.res_target_h}h`);
    for (const f of st.missing_blocking_info) {
      await expect(page.getByTestId("required-1").locator(`[data-field="${f}"]`)).toHaveAttribute("data-state", "blocking");
    }
    expect(st.missing_blocking_info).toContain("serial_no");

    await expect(tab(page, "정보 요청")).toHaveAttribute("aria-selected", "true");
    const card = page.getByTestId("draft-card").first();
    await expect(card).toHaveAttribute("data-type", "INFO_REQUEST");
    await expect(card.locator(".tk-draft__head")).toContainText("en");
  });

  test("SCR-03-AC-2: 우선순위 [근거 보기]를 누르면 P1에 규칙 번호와 조건, 판정 근거가 보인다", async ({ page, request }) => {
    const c3 = (await detail(request, DEMO_17)).sub_tickets[0].evidence_rows.find((r: Json) => r.id === "C-03");
    await page.goto(`/tickets/${DEMO_17}?tab=system`);
    await row(page, 1, "C-03").getByRole("button", { name: "근거 보기" }).click();
    const p1 = dialog(page, /근거 보기/);
    await expect(p1).toBeVisible();
    await expect(p1).toContainText(c3.why.rule.rule_id);
    await expect(p1).toContainText(c3.why.rule.condition);
    await expect(p1).toContainText(c3.evidence[0]);
  });

  test("SCR-03-AC-3: 000008 사본 — ②에 문의 칸 2개, ③ 답변 탭에 카드 2개", async ({ page, request }) => {
    const d = await detail(request, DEMO_08, "TS_ENERGY");
    await useSession(page, { dept: "TS_ENERGY", agent: "leo" });
    await page.goto(`/tickets/${DEMO_08}?tab=system`);
    await expect(page.locator("[data-testid^=judge-]")).toHaveCount(2);
    for (const s of d.sub_tickets) await expect(row(page, s.sub_ticket.seq, "C-01")).toContainText(s.sub_ticket.category_code);
    await tab(page, "답변").click();
    await expect(page.locator('[data-testid=draft-card][data-type="FINAL_REPLY"]')).toHaveCount(2);
  });

  test("SCR-03-AC-4: 000004 사본 — 프랑스어 초안 옆에 한국어 대역, '520.00 USD'가 조회값 링크", async ({ page, request }) => {
    const draft = (await detail(request, DEMO_04)).sub_tickets[0].drafts.find((x: Json) => x.message_type === "FINAL_REPLY");
    await page.goto(`/tickets/${DEMO_04}?tab=system`);
    const card = page.locator('[data-testid=draft-card][data-type="FINAL_REPLY"]');
    await expect(card.locator(".tk-draft__head")).toContainText("fr");
    await expect(card.getByTestId("gloss")).toHaveText(draft.gloss.body);
    await expect(card.getByTestId("draft-body")).toContainText("520.00 USD");
    const price = card.getByTestId("draft-body").getByRole("button", { name: "520.00", exact: true }).first();
    await expect(price).toBeVisible();
    await price.click();
    await expect(dialog(page, "조회값 출처")).toContainText("520");
  });

  test("SCR-03-AC-5: 분류 실패(목) — ① 유형 줄만 '없음(분류 실패)', 나머지 줄은 그대로", async ({ page }) => {
    await mockDetail(page, DEMO_17, (d) => {
      const s = d.sub_tickets[0];
      s.sub_ticket.category_code = null;
      s.evidence_rows.find((r: Json) => r.id === "C-01").result = "없음(분류 실패)";
    });
    await page.goto(`/tickets/${DEMO_17}?tab=system`);
    await expect(row(page, 1, "C-01")).toContainText("없음(분류 실패)");
    await expect(row(page, 1, "C-02")).toContainText("SAFETY");
    await expect(row(page, 1, "C-04")).toContainText("TS_LV");
  });

  test("SCR-03-AC-6: SAFETY 문의 초안의 검토 표시는 5개, ④ '확인 필요: 안전 문의'", async ({ page }) => {
    await page.goto(`/tickets/${DEMO_17}?tab=system`);
    const marks = page.getByTestId("draft-card").first().getByTestId("review-marks").locator("[data-no]");
    await expect(marks).toHaveCount(5);
    await expect(marks.nth(3)).toHaveText("④ 확인 필요: 안전 문의");
  });

  test("SCR-03-AC-7: 검증 두 번 시간 초과(목) — ⑤ '검증 못 함(실패)', [다시 검증] 보임, [승인하고 발송] 켜짐", async ({ page }) => {
    await mockDetail(page, DEMO_17, (d) => {
      const m = d.sub_tickets[0].drafts[0].review_marks.marks.find((x: Json) => x.no === 5);
      Object.assign(m, { passed: false, state: "FAILED", text: "⑤ 검증 못 함(실패)", full_text: "⑤ 검증 못 함(실패): 시간 초과 2회" });
    });
    await page.goto(`/tickets/${DEMO_17}?tab=system`);
    const card = page.getByTestId("draft-card").first();
    await expect(card.locator('[data-no="5"]')).toHaveText("⑤ 검증 못 함(실패)");
    await expect(card.getByRole("button", { name: "다시 검증" })).toBeVisible();
    await expect(card.getByRole("button", { name: "승인하고 발송" })).toBeEnabled();
  });

  test("SCR-03-AC-12: 대역 만들기 실패(목) — '대역 없음(번역 실패)'와 [다시 만들기], [승인하고 발송] 켜짐", async ({ page }) => {
    await mockDetail(page, DEMO_17, (d) => { d.sub_tickets[0].drafts[0].gloss = null; });
    await page.goto(`/tickets/${DEMO_17}?tab=system`);
    const card = page.getByTestId("draft-card").first();
    await expect(card.getByTestId("gloss")).toHaveText("대역 없음(번역 실패)");
    await expect(card.getByRole("button", { name: "다시 만들기" })).toBeVisible();
    await expect(card.getByRole("button", { name: "승인하고 발송" })).toBeEnabled();
  });

  test("SCR-03-AC-19 (인용 쪽): 답변 초안 인용에 해결사례가 없다", async ({ page, request }) => {
    const d = await detail(request, DEMO_07, "TS_AUTO");
    await useSession(page, { dept: "TS_AUTO", agent: "leo" });
    await page.goto(`/tickets/${DEMO_07}?tab=system`);
    const body = await page.locator('[data-testid=draft-card][data-type="FINAL_REPLY"]').getByTestId("draft-body").innerText();
    expect(body).not.toMatch(/RC-\d|CSV1-\d{6}/); // 해결사례 번호·원래 티켓 번호를 인용하지 않는다(설계 원칙 5)
    expect(d.sub_tickets[0].sub_ticket.evidence_json.every((c: Json) => !String(c.doc_id).startsWith("RC"))).toBeTruthy();
  });

  test("SCR-03-AC-20: 근거가 없어 답변 초안이 없는 문의(목) — '근거 없음 — 상담원 작성 필요'와 빈 편집기가 바로 보인다", async ({ page }) => {
    await useSession(page, { dept: "TS_AUTO", agent: "leo" });
    await mockDetail(page, DEMO_07, (d) => {
      const s = d.sub_tickets[0];
      s.drafts = [];
      s.evidence_rows.find((r: Json) => r.id === "M-C-02").result = "없음(근거 없음)";
    });
    await page.goto(`/tickets/${DEMO_07}?tab=system`);
    await tab(page, "답변").click();
    await expect(page.getByTestId("no-draft")).toContainText("근거 없음 — 상담원 작성 필요");
    const editor = page.getByRole("textbox", { name: "직접 쓰는 답변" });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue("");
    await expect(page.getByRole("button", { name: "직접 작성" })).toHaveCount(0);
  });

  test("SCR-03-AC-21: 없는 번호 CSV1-999999 — '티켓을 찾을 수 없습니다'와 [접수함으로]", async ({ page }) => {
    await page.goto("/tickets/CSV1-999999");
    await expect(page.getByText("티켓을 찾을 수 없습니다 CSV1-999999")).toBeVisible();
    await page.getByRole("button", { name: "접수함으로" }).click();
    await expect(page).toHaveURL(/\/inbox/);
  });
});

test.describe.serial("000017 사본 A: 발송 → 충돌 → 회신", () => {
  test.setTimeout(300_000);
  let id = "";
  test.beforeAll(async ({ request }) => { test.setTimeout(300_000); id = await intakeCopy(request, "CSV1-000017"); });
  test.beforeEach(async ({ page }) => useSession(page, { dept: "TS_LV", agent: "leo" }));

  // 비슷한 해결사례는 상담원 도우미(ELLO)로 물어보게 되어 ② 탭에서 뺐다(add-ello-assistant). 초안 인용에도 해결사례는 없다.
  test("SCR-03-AC-19: ② 탭에 비슷한 해결사례 블록이 없고, 초안 인용에 해결사례가 없다", async ({ page, request }) => {
    await page.goto(`/tickets/${id}?tab=system`);
    await expect(page.getByTestId("judge-1")).toBeVisible();
    await expect(page.getByTestId("similar-cases")).toHaveCount(0);
    const d = await detail(request, id);
    for (const s of d.sub_tickets) for (const dr of s.drafts ?? []) expect(String(dr.body ?? "")).not.toMatch(/RC-\d{4}/);
  });

  test("SCR-03-AC-8 + AC-10: 정보 요청 [승인하고 발송] → [발송]이면 '발송됨', 상태 '고객 회신 대기', 1차 응답 '보냄'. 다른 창에서 다시 보내면 P8 '이미 발송된 초안'", async ({ page, context }) => {
    const other = await context.newPage(); // 같은 초안을 연 두 번째 상담원 창(AC-10)
    await page.goto(`/tickets/${id}?tab=system`);
    await other.goto(`/tickets/${id}?tab=system`);
    await expect(other.getByTestId("draft-card").first()).toHaveAttribute("data-state", "draft");

    const card = page.getByTestId("draft-card").first();
    await card.getByRole("button", { name: "승인하고 발송" }).click();
    const p7 = dialog(page, "발송 전 확인");
    await p7.getByRole("button", { name: /^(발송|그래도 발송)$/ }).click();
    await expect(card).toHaveAttribute("data-state", "sent");
    await expect(card.getByTestId("sent-line")).toContainText(/발송됨 \d{4}-\d\d-\d\d \d\d:\d\d UTC · leo/);
    const head = page.getByRole("region", { name: "티켓 요약" });
    await expect(head.locator(".tk-head__top .ui-chip").first()).toContainText("고객 회신 대기");
    await expect(head.getByTestId("sla-fr")).toHaveCount(0); // 1차 응답을 보냈으면 1차 응답 기한 문장이 없다

    await other.getByTestId("draft-card").first().getByRole("button", { name: "승인하고 발송" }).click();
    await dialog(other, "발송 전 확인").getByRole("button", { name: /^(발송|그래도 발송)$/ }).click();
    await expect(dialog(other, "처리하지 못했습니다")).toContainText("이미 발송된 초안");
  });

  test("SCR-03-AC-18: P6 회신 시각을 정보 요청 발송보다 앞으로 넣으면 '회신 시각은 요청 발송 이후여야 합니다'", async ({ page }) => {
    await page.goto(`/tickets/${id}?tab=history`);
    await page.getByRole("button", { name: "고객 회신 입력" }).click();
    const p6 = dialog(page, "고객 회신 입력");
    await p6.getByRole("textbox", { name: /회신 본문/ }).fill("Serial number is LVB-2024-00117.");
    await p6.getByLabel(/회신 시각/).fill("2020-01-01T00:00");
    await p6.getByRole("button", { name: "입력" }).click();
    await expect(p6).toContainText("회신 시각은 요청 발송 이후여야 합니다");
  });

  test("SCR-03-AC-17: P6에 'Serial number is LVB-2024-00117.'을 넣으면 처리 중을 거쳐 C-07 serial_no가 ✓, 답변 탭이 API 값대로 바뀐다", async ({ page, request }) => {
    await page.goto(`/tickets/${id}?tab=history`);
    await page.getByRole("button", { name: "고객 회신 입력" }).click();
    const p6 = dialog(page, "고객 회신 입력");
    await p6.getByRole("textbox", { name: /회신 본문/ }).fill("Serial number is LVB-2024-00117.");
    await p6.getByRole("button", { name: "입력" }).click();
    await expect(p6).toBeHidden();
    const d = await waitDone(request, id);
    await page.goto(`/tickets/${id}?tab=system`);
    await expect(page.getByTestId("required-1").locator('[data-field="serial_no"]')).toHaveAttribute("data-state", "provided");
    await tab(page, "답변").click();
    const answer = d.sub_tickets[0].drafts.some((x: Json) => x.message_type === "FINAL_REPLY" && !x.superseded_at);
    if (answer) await expect(page.locator('[data-testid=draft-card][data-type="FINAL_REPLY"]')).toBeVisible();
    else await expect(page.getByTestId("no-draft")).toContainText("막는 정보 요청 중"); // 다른 막는 항목(error_code)이 남은 경우
  });
});

test.describe.serial("000017 사본 B: 이관", () => {
  test.setTimeout(300_000);
  let id = "";
  test.beforeAll(async ({ request }) => { test.setTimeout(300_000); id = await intakeCopy(request, "CSV1-000017"); });

  test("SCR-03-AC-15: P4에서 사유 없이 [이관]이면 '이관 사유를 고르세요', ONSITE_REQUIRED로 FIELD_SVC에 이관하면 '이관됨'", async ({ page }) => {
    await useSession(page, { dept: "TS_LV", agent: "leo" });
    await page.goto(`/tickets/${id}?tab=system`);
    await page.getByRole("button", { name: "이관", exact: true }).click();
    const p4 = dialog(page, "이관");
    await p4.getByLabel(/이관 사유/).selectOption("");
    await p4.getByRole("button", { name: "이관", exact: true }).click();
    await expect(p4).toContainText("이관 사유를 고르세요");
    await p4.getByLabel(/이관 부서/).selectOption("FIELD_SVC");
    await p4.getByLabel(/이관 사유/).selectOption("ONSITE_REQUIRED");
    await p4.getByRole("button", { name: "이관", exact: true }).click();
    await expect(p4).toBeHidden();
    const head = page.getByRole("region", { name: "티켓 요약" });
    await expect(head.locator(".tk-head__top .ui-chip").first()).toContainText("이관됨");
    await expect(page.getByRole("button", { name: "이관", exact: true })).toBeDisabled();
  });
});

test.describe.serial("000004 사본 C: 고치기 → 근거 밖 숫자", () => {
  test.setTimeout(300_000);
  let id = "";
  test.beforeAll(async ({ request }) => { test.setTimeout(300_000); id = await intakeCopy(request, "CSV1-000004", "SALES_OPS"); });
  test.beforeEach(async ({ page }) => useSession(page, { dept: "SALES_OPS", agent: "leo" }));

  test("SCR-03-AC-11: 한 문장을 고쳐 [임시 저장]하면 대역이 바뀌고 ⑤가 '고친 뒤 검증 안 함'", async ({ page }) => {
    await page.goto(`/tickets/${id}?tab=system`);
    const card = page.locator('[data-testid=draft-card][data-type="FINAL_REPLY"]');
    const before = await card.getByTestId("gloss").innerText();
    await card.getByRole("button", { name: "본문 고치기" }).click();
    const editor = card.getByRole("textbox", { name: "초안 본문" });
    await editor.fill(`${await editor.inputValue()}\n\nNous pouvons livrer en deux semaines si vous confirmez aujourd'hui.`);
    await card.getByRole("button", { name: "임시 저장" }).click();
    await expect(card.locator('[data-no="5"]')).toHaveText(/고친 뒤 검증 안 함/, { timeout: 60_000 });
    await expect(card.getByTestId("gloss")).not.toHaveText(before, { timeout: 60_000 });
  });

  test("SCR-03-AC-9: 조회값에 없는 숫자를 넣고 승인하면 P7에 '근거 밖 숫자', [그래도 발송]이면 발송된다", async ({ page }) => {
    await page.goto(`/tickets/${id}?tab=system`);
    const card = page.locator('[data-testid=draft-card][data-type="FINAL_REPLY"]');
    await card.getByRole("button", { name: "본문 고치기" }).click();
    const editor = card.getByRole("textbox", { name: "초안 본문" });
    await editor.fill(`${await editor.inputValue()}\n\nRemise spéciale : 999.00 USD.`);
    await card.getByRole("button", { name: "승인하고 발송" }).click();
    const p7 = dialog(page, "발송 전 확인");
    await p7.getByRole("button", { name: "발송", exact: true }).click();
    await expect(p7.getByTestId("send-issues")).toContainText(/근거 밖 (인용\/)?숫자.*999\.00/); // 서버 문구 "근거 밖 인용/숫자 n곳: …"
    await p7.getByRole("button", { name: "그래도 발송" }).click();
    await expect(card).toHaveAttribute("data-state", "sent");
    await expect(card).toContainText("확인하고 발송");
  });
});

test.describe.serial("000031 사본 D: 우선순위 조정 → RND_FW 이관", () => {
  test.setTimeout(300_000);
  let id = "";
  let sub = "";
  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    id = await intakeCopy(request, "CSV1-000031", "TS_AUTO");
    // 정답지 유형은 MANUAL(P4, 72h/168h). 파이프라인이 FW_UPDATE로 봤으면 상담원이 고치는 길(FR-030 처리 5)로 맞춘다
    let d = await detail(request, id, "TS_AUTO");
    const s = d.sub_tickets[0];
    sub = s.sub_ticket.sub_ticket_id;
    if (s.sub_ticket.category_code !== "MANUAL") {
      await request.patch(api(`/sub-tickets/${sub}`), { headers: H(s.sub_ticket.assigned_dept), data: { category_code: "MANUAL", expected_version: s.version } });
      d = await waitDone(request, id, "TS_AUTO");
    }
  });
  test.beforeEach(async ({ page, request }) => {
    const d = await detail(request, id, "TS_AUTO");
    await useSession(page, { dept: d.sub_tickets[0].sub_ticket.assigned_dept, agent: "leo" });
  });

  test("SCR-03-AC-14: P3에서 사유를 비우고 [조정]이면 '조정 사유를 입력하세요', 값은 그대로", async ({ page, request }) => {
    const before = (await detail(request, id, "TS_AUTO")).sub_tickets[0].sub_ticket.priority;
    await page.goto(`/tickets/${id}?tab=system`);
    await row(page, 1, "C-03").getByRole("button", { name: "조정" }).click();
    const p3 = dialog(page, /우선순위 조정/);
    await p3.getByRole("button", { name: "조정" }).click();
    await expect(p3).toContainText("조정 사유를 입력하세요");
    await p3.getByRole("button", { name: "취소" }).click();
    await expect(row(page, 1, "C-03")).toContainText(before);
  });

  test("SCR-03-AC-13: P4(72h/168h)에서 사유를 넣고 P3로 조정하면 C-03 'P4 → P3 (상담원 조정)', C-06 24h/120h", async ({ page, request }) => {
    const st = (await detail(request, id, "TS_AUTO")).sub_tickets[0];
    expect(st.sub_ticket.priority).toBe("P4");
    expect([st.sla.fr_target_h, st.sla.res_target_h]).toEqual([72, 168]);
    await page.goto(`/tickets/${id}?tab=system`);
    await row(page, 1, "C-03").getByRole("button", { name: "조정" }).click();
    const p3 = dialog(page, /우선순위 조정/);
    await p3.getByLabel(/새 우선순위/).selectOption("P3");
    await p3.getByLabel(/사유 분류/).selectOption("CUSTOMER_REQUEST");
    await p3.getByRole("textbox", { name: /^사유/ }).fill("고객이 다음 주 시운전 일정을 알려 옴");
    await expect(p3.getByTestId("adjust-preview")).toContainText("72/168 h → 24/120 h");
    await p3.getByRole("button", { name: "조정" }).click();
    await expect(p3).toBeHidden();
    await expect(row(page, 1, "C-03")).toContainText("P4 → P3 (상담원 조정");
    // SLA 줄은 남은 시간과 목표를 1차 응답 기한·해결 기한으로 따로 적는다(add-ticket-detail-layout)
    await expect(row(page, 1, "C-06")).toContainText("1차 응답 기한");
    await expect(row(page, 1, "C-06")).toContainText("목표 24h");
    await expect(row(page, 1, "C-06")).toContainText("해결 기한");
    await expect(row(page, 1, "C-06")).toContainText("목표 120h");
  });

  test("SCR-03-AC-16: RND_FW로 이관된 문의를 RND_FW 상담원이 열면 [임시 저장]·[승인하고 발송] 없이 회신 작성란과 [회신 등록]만", async ({ page, request }) => {
    const s = (await detail(request, id, "TS_AUTO")).sub_tickets[0];
    const res = await request.post(api(`/sub-tickets/${sub}/escalate`), {
      headers: H(s.sub_ticket.assigned_dept), data: { dept: "RND_FW", reason_code: "FW_UPDATE_FAILURE", memo: "", expected_version: s.version } });
    expect(res.ok()).toBeTruthy();
    await page.goto(`/tickets/${id}?tab=system`);
    await page.evaluate(() => { localStorage.setItem("cs-agent-dept", "RND_FW"); localStorage.setItem("cs-agent-id", "nora"); });
    await page.reload();
    const writer = page.getByTestId("dept-writer");
    await expect(writer).toHaveAttribute("data-writer", "DEPT_REPLY");
    await expect(writer.getByRole("textbox", { name: "회신 본문" })).toBeVisible();
    await expect(writer.getByRole("button", { name: "회신 등록" })).toBeVisible();
    await expect(page.getByRole("button", { name: "임시 저장" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "승인하고 발송" })).toHaveCount(0);
  });
});
