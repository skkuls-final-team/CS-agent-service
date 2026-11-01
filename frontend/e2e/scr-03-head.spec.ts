// SCR-03 머리 영역 (최신 목업에 맞춤, 변경 add-inbox-turn-depth): 접수 정보 줄, 지금 할 일·검토 모드 띠, 이전·다음 문의 이동.
import { expect, test } from "@playwright/test";
import { useSession } from "./session";
import { intakeCopy } from "./ticket";

const rows = (page: import("@playwright/test").Page) => page.locator("table.ui-table tbody tr.is-link");

test("SCR-03-AC-22: 접수 정보 줄과 '지금 할 일' 띠(검토 모드 포함)가 머리 아래에 보인다", async ({ page, request }) => {
  // 재생 데이터 티켓은 처리 기록이 없어 "처리 중"으로 보이므로, 처리가 끝난 티켓(시연 접수본)을 API로 찾는다
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=200&include_closed=true")).json();
  let id = "";
  for (const r of list.rows) {
    const d = await (await request.get(`http://localhost:8000/tickets/${r.ticket_id}`)).json();
    if (!d.processing && d.run) { id = r.ticket_id; break; }
  }
  expect(id, "처리가 끝난 TS_LV 티켓(python -m jobs.run_tickets CSV1-000017)").not.toBe("");
  await useSession(page, { dept: "TS_LV" });
  await page.goto(`/tickets/${id}`);
  const now = page.getByTestId("now-strip");
  await expect(now).toBeVisible();
  await expect(now).toContainText(/내 차례|대기|완료/);
  await expect(now).toContainText(/검토 모드 · (상세 검토|일반 확인|빠른 확인)/);
  await expect(page.locator(".tk-recv")).toContainText(/접수 \d{4}-\d{2}-\d{2} \d{2}:\d{2} · /);
});

test("SCR-03-AC-23: 접수함에서 열면 'n / 전체'가 보이고, 다음 문의 버튼과 j·k 키로 접수함 순서대로 이동한다", async ({ page }) => {
  await useSession(page, { dept: "TS_LV", snapshot: true });
  await page.goto("/inbox");
  await expect(rows(page).first()).toBeVisible();
  const ids = [...new Set((await rows(page).locator(".ui-tid").allInnerTexts()).map((t) => t.replace(/ #\d+$/, "").trim()))];
  expect(ids.length).toBeGreaterThan(2);
  await rows(page).first().click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ids[0]}$`));
  const nav = page.getByRole("group", { name: "이전·다음 문의" });
  await expect(nav).toContainText(`1 / ${ids.length}`);
  await expect(nav.getByRole("button", { name: /이전 문의/ })).toBeDisabled();
  await nav.getByRole("button", { name: /다음 문의/ }).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ids[1]}$`));
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`/tickets/${ids[2]}$`));
  await page.keyboard.press("k");
  await expect(page).toHaveURL(new RegExp(`/tickets/${ids[1]}$`));
});

test("SCR-03-AC-24 (add-ticket-detail-layout): '답변 초안'과 '판단과 근거'가 한 줄에 나란히 있고, 고객 원문은 탭으로 바꿔 보며, 내부 메모·이력은 접혀 있다가 열면 보인다", async ({ page, request }) => {
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=200&include_closed=true")).json();
  let id = "";
  for (const r of list.rows) {
    const d = await (await request.get(`http://localhost:8000/tickets/${r.ticket_id}`)).json();
    if (!d.processing && d.run) { id = r.ticket_id; break; }
  }
  expect(id).not.toBe("");
  await useSession(page, { dept: "TS_LV" });
  await page.goto(`/tickets/${id}?tab=system`);
  const send = page.getByRole("region", { name: "답변 초안" });
  const side = page.getByRole("region", { name: "판단과 고객 원문" });
  await expect(send).toBeVisible();
  await expect(side).toBeVisible();
  const [s, d] = await Promise.all([send.boundingBox(), side.boundingBox()]);
  expect(s!.x).toBeLessThan(d!.x); // 왼쪽 쓰기, 오른쪽 판단
  expect(Math.abs(s!.y - d!.y)).toBeLessThan(5); // 같은 줄
  await expect(page.getByRole("region", { name: "시스템이 판단한 것" })).toBeVisible();
  // 고객이 보낸 것 탭: 원문과 번역 칸
  await page.getByRole("tab", { name: "고객이 보낸 것" }).click();
  await expect(page.getByRole("region", { name: "고객 문의 원문" })).toBeVisible();
  await expect(page.getByTestId("inquiry-body")).toBeVisible();
  // 위쪽 [원문 보기]도 같은 탭으로 바꾼다
  await page.getByRole("tab", { name: "판단과 근거" }).click();
  await page.getByRole("button", { name: "원문 보기" }).click();
  await expect(page.getByRole("tab", { name: "고객이 보낸 것" })).toHaveAttribute("aria-selected", "true");
  // 내부 메모·이력은 접혀 있다
  await expect(page.getByRole("region", { name: "이력" })).toBeHidden();
  await page.locator("#tk-sec-history > summary").click();
  await expect(page.getByRole("region", { name: "이력" })).toBeVisible();
  // 옛 탭 주소는 그 구역을 연다
  await page.goto(`/tickets/${id}?tab=history`);
  await expect(page.getByRole("region", { name: "이력" })).toBeVisible();
  await page.goto(`/tickets/${id}?tab=customer`);
  await expect(page.getByRole("tab", { name: "고객이 보낸 것" })).toHaveAttribute("aria-selected", "true");
});

test("SCR-03-AC-25: 초안을 고치는 중에도 ⑤ 검증이 지적한 문장이 형광펜으로 보이고, 그 문장을 지우면 표시가 사라진다", async ({ page, request }) => {
  // ⑤ 지적(findings)이 있는 초안을 가진 처리 끝난 티켓을 API로 찾는다(시연 접수본)
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=200&include_closed=true")).json();
  let id = "", quote = "", body = "";
  for (const r of list.rows) {
    const d = await (await request.get(`http://localhost:8000/tickets/${r.ticket_id}`, { headers: { "X-Agent-Dept": "TS_LV" } })).json();
    if (d.processing || !d.run) continue;
    const dr = d.sub_tickets[0].drafts.find((x: { superseded_at: string | null; review_marks: { marks: { no: number; findings?: { quote: string }[] }[] }; body: string; message_type: string }) =>
      !x.superseded_at && x.message_type === "INFO_REQUEST" && x.review_marks.marks.find((m) => m.no === 5)?.findings?.length);
    if (dr) { id = r.ticket_id; body = dr.body; quote = dr.review_marks.marks.find((m: { no: number }) => m.no === 5).findings[0].quote; break; }
  }
  expect(id, "⑤ 지적이 있는 정보 요청 초안을 가진 티켓").not.toBe("");
  expect(body.includes(quote)).toBe(true);
  await useSession(page, { dept: "TS_LV", agent: "leo" });
  await page.goto(`/tickets/${id}`);
  const card = page.getByTestId("draft-card").first();
  await card.getByRole("button", { name: "본문 고치기" }).click();
  const marks = card.locator(".ui-mk__ov mark");
  await expect(marks.first()).toBeVisible();
  await expect(card.getByTestId("mark-legend")).toBeVisible();
  const marked = (await marks.allInnerTexts()).join("");
  expect(marked).toContain(quote.slice(0, 20));
  // 지적된 문장을 지우면 그 구간의 표시가 사라진다
  const edited = body.split(quote).join("");
  await card.getByRole("textbox", { name: "초안 본문" }).fill(edited);
  const after = (await card.locator(".ui-mk__ov mark").allInnerTexts()).join("");
  expect(after.includes(quote.slice(0, 20))).toBe(false);
});

test("SCR-03-AC-26 (최신 목업): 내부 메모를 남기면 남긴 사람과 함께 목록에 보이고, 접수함 줄에 '메모 n'이 붙으며, 초안에는 섞이지 않는다", async ({ page, request }) => {
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=200&include_closed=true")).json();
  let id = "";
  for (const r of list.rows) {
    const d = await (await request.get(`http://localhost:8000/tickets/${r.ticket_id}`)).json();
    if (!d.processing && d.run) { id = r.ticket_id; break; }
  }
  expect(id).not.toBe("");
  const text = `시험 메모 ${Date.now()}`;
  await useSession(page, { dept: "TS_LV", agent: "leo" });
  await page.goto(`/tickets/${id}`);
  await page.locator("#tk-fold-memo > summary").click(); // 내부 메모는 접혀 있다
  const memo = page.getByRole("region", { name: "내부 메모" });
  await expect(memo).toContainText("고객에게 보이지 않습니다");
  await expect(memo.getByRole("button", { name: "메모 남기기" })).toBeDisabled(); // 비어 있으면 꺼짐
  await memo.getByRole("textbox", { name: "내부 메모" }).fill(text);
  await memo.getByRole("button", { name: "메모 남기기" }).click();
  await expect(memo.getByTestId("memo-list")).toContainText(text);
  await expect(memo.getByTestId("memo-list")).toContainText("leo");
  await expect(memo.getByRole("textbox", { name: "내부 메모" })).toHaveValue(""); // 남기면 입력칸이 비워짐
  // 고객에게 가는 초안·원문 칸에는 섞이지 않는다
  await expect(page.getByRole("region", { name: "답변 초안" })).not.toContainText(text);
  // 접수함 줄에 메모 개수가 붙는다
  await page.goto(`/inbox?q=${id}&include_closed=true&m=0`);
  await expect(page.locator("table.ui-table tbody tr.is-link").first().locator(".inbox-memo")).toContainText(/메모 \d+/);
});

test("SCR-03-AC-27 (최신 목업): 접수 때 만들어 저장한 한국어 요약이 접수함 문의 칸과 상세 머리에 같은 문장으로 보인다", async ({ page, request }) => {
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=200&include_closed=true")).json();
  const hit = list.rows.find((r: { summary_ko: string | null }) => r.summary_ko);
  expect(hit, "요약이 있는 TS_LV 접수본(python -m jobs.run_tickets CSV1-000017)").toBeTruthy();
  const { ticket_id: id, summary_ko: summary } = hit as { ticket_id: string; summary_ko: string };
  await useSession(page, { dept: "TS_LV", agent: "leo" });
  await page.goto(`/inbox?q=${id}&m=0&include_closed=true`);
  const cell = page.locator("table.ui-table tbody tr.is-link").first().locator(".inbox-subject");
  await expect(cell).toHaveText(summary);
  await expect(cell).toHaveAttribute("data-summary", "ai");
  await page.reload(); // 다시 열어도 같은 문장(화면을 열 때마다 모델을 부르지 않는다)
  await expect(page.locator("table.ui-table tbody tr.is-link").first().locator(".inbox-subject")).toHaveText(summary);
  await page.goto(`/tickets/${id}`);
  await expect(page.getByTestId("ai-summary")).toContainText(summary);
});

test.describe.serial("이관 메일 (최신 목업)", () => {
  test.setTimeout(300_000);
  let id = "";
  test.beforeAll(async ({ request }) => { test.setTimeout(300_000); id = await intakeCopy(request, "CSV1-000017"); });

  test("SCR-03-AC-28: 이관 팝업의 '메일로도 보내기'(처음부터 켜짐, 받는 곳·제목 미리보기)로 이관하면 이력에 '이관 요청 메일 발송'이 남고, [회신 메일 도착 (시연)]을 누르면 '회신 메일 수신'과 함께 처리 중으로 돌아온다", async ({ page }) => {
    await useSession(page, { dept: "TS_LV", agent: "leo" });
    await page.goto(`/tickets/${id}`);
    await page.getByRole("button", { name: "이관", exact: true }).click();
    const p4 = page.getByRole("dialog", { name: "이관" });
    const box = p4.getByTestId("mail-box");
    await expect(box.getByRole("checkbox", { name: /메일로도 보내기/ })).toBeChecked();
    await expect(box).toContainText("실제 발송과 회신 인식은 아직 연결되어 있지 않습니다"); // 시안임을 숨기지 않는다
    await p4.getByLabel(/이관 부서/).selectOption("FIELD_SVC");
    await p4.getByLabel(/이관 사유/).selectOption("ONSITE_REQUIRED");
    await expect(box).toContainText("받는 곳");
    await expect(box).toContainText(`[${id}] 이관 요청 · ONSITE_REQUIRED`);
    await p4.getByRole("button", { name: "이관", exact: true }).click();
    await expect(p4).toBeHidden();
    await page.locator("#tk-sec-history:not([open]) > summary").click(); // 이력은 접혀 있다(이미 열려 있으면 건너뜀)
    const history = page.getByRole("region", { name: "이력" });
    await expect(history.getByTestId("timeline")).toContainText("이관 요청 메일 발송");
    await expect(history.getByTestId("mail-wait")).toBeVisible();
    await history.getByRole("button", { name: "회신 메일 도착 (시연)" }).click();
    await expect(history.getByTestId("timeline")).toContainText("회신 메일 수신");
    await expect(history.getByTestId("mail-wait")).toHaveCount(0); // 회신이 오면 더는 기다리지 않는다
    const head = page.getByRole("region", { name: "티켓 요약" });
    await expect(head.locator(".tk-head__top .ui-chip").first()).not.toContainText("이관됨");
  });
});

test("SCR-03-AC-29 (최신 목업, 변경 add-body-translation): 번역이 없으면 [번역 보기]가 보이고, 누르면 '한국어 번역 · 검토용' 아래에 번역이 나타나며 단추는 사라진다. 실패하면 서버 문구가 보이고 단추가 남는다", async ({ page, request }) => {
  // 언어 모델 호출(Gemini)을 피하려고 번역 요청과 그 뒤 상세 응답만 흉내 낸다. 나머지 값은 실제 서버 값이다.
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=1&include_closed=true")).json();
  const id = list.rows[0].ticket_id as string;
  const KO = "[시험] 펌웨어 릴리스 노트를 보내 주세요.";
  let translated = false;
  let fail = true;
  await page.route(new RegExp(`/api/tickets/${id}(\\?.*)?$`), async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.ticket.body_ko = translated ? KO : null;
    await route.fulfill({ response: res, json });
  });
  await page.route(new RegExp(`/api/tickets/${id}/translate$`), async (route) => {
    if (fail) { await route.fulfill({ status: 502, json: { detail: "번역하지 못했습니다. 잠시 뒤 다시 시도하세요" } }); return; }
    translated = true;
    await route.fulfill({ json: { ticket_id: id, body_ko: KO, cached: false } });
  });
  await useSession(page, { dept: "TS_LV" });
  await page.goto(`/tickets/${id}?tab=customer`);
  const block = page.getByTestId("body-ko-block");
  await expect(block).toContainText("한국어 번역 · 검토용");
  await block.getByRole("button", { name: "번역 보기" }).click();
  await expect(block.getByRole("alert")).toContainText("번역하지 못했습니다");
  await expect(block.getByRole("button", { name: "번역 보기" })).toBeVisible(); // 실패하면 다시 누를 수 있다
  fail = false;
  await block.getByRole("button", { name: "번역 보기" }).click();
  await expect(page.getByTestId("body-ko")).toHaveText(KO);
  await expect(block.getByRole("button", { name: "번역 보기" })).toHaveCount(0);
});

test("SCR-03-AC-30 (최신 목업, 변경 add-ticket-head-look): 머리에 숫자 6칸 대신 고객사·등급이 제목 줄에, 접수 줄 끝에 '해결 기한 … 초과/남음'이 보인다", async ({ page, request }) => {
  const list = await (await request.get("http://localhost:8000/tickets?dept=TS_LV&size=1&as_of=2026-09-30T23:59:00Z")).json();
  await useSession(page, { dept: "TS_LV", snapshot: true });
  await page.goto(`/tickets/${list.rows[0].ticket_id}`);
  const head = page.getByRole("region", { name: "티켓 요약" });
  await expect(head.locator(".tk-stat")).toHaveCount(0);
  await expect(head.locator(".tk-head__co")).toBeVisible();
  await expect(head.getByTestId("sla-res")).toContainText(/해결 기한 .*(초과|남음|멈춤)/);
});
