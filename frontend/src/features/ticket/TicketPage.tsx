// SCR-03 티켓 상세 (명세서 FR-030). 배치는 최신 목업(탭 없는 한 화면): 머리 카드 + 지금 할 일 띠 + 경고 띠 +
// [읽기: 고객이 보낸 것 | 쓰기: 보낼 것] 두 칸(첫 화면) → 시스템이 판단한 것(근거) → 이력. 옛 탭 주소(?tab=)는 그 구역으로 스크롤한다.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, SNAPSHOT, type Draft, type EvidenceRow, type SubTicket } from "../../api";
import { useSession } from "../../app/session";
import { Banner, Button, EmptyState } from "../../ui";
import { AdjustPopup, EscalatePopup, ReplyPopup } from "./ActionPopups";
import { CustomerTab } from "./CustomerTab";
import { useDepartments } from "../../app/queries";
import { inboxOrder } from "../inbox/inboxQuery";
import { HeadCard, NowStrip } from "./HeadCard";
import { OpenTabs, rememberOpenTab } from "./openTabs";
import { HistoryTab } from "./HistoryTab";
import { MemoCard } from "./MemoCard";
import { FailPopup, SourcePopup, WhyPopup, type SourceTarget } from "./Popups";
import { SendTab } from "./SendTab";
import { SystemTab } from "./SystemTab";
import { useRefresh, useTicket } from "./ticketQuery";
import "./ticket.css";

/** 시연용 회신 메일 본문. 실제 메일 연동이 없어 부서가 메일로 답장한 것처럼 반영한다(add-escalation-mail) */
const MAIL_REPLY_DEMO = "[시연] 요청하신 건을 확인했습니다. 회신 메일 자동 반영 시연이며 실제 부서 회신이 아닙니다.";

type Section = "customer" | "system" | "send" | "history";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "customer", label: "고객이 보낸 것" }, { key: "send", label: "보낼 것" },
  { key: "system", label: "시스템이 판단한 것" }, { key: "history", label: "이력" },
];
/** 오른쪽 칸 탭: 판단과 근거(훑어보는 표) | 고객이 보낸 것(원문·한국어 번역) */
type Side = "judge" | "customer";

/** 옛 탭 주소(?tab=customer 등)로 들어오면 그 구역으로 스크롤한다. 없으면 맨 위 */
function sectionFromUrl(): Section | null {
  const t = new URLSearchParams(window.location.search).get("tab");
  return SECTIONS.some((x) => x.key === t) ? (t as Section) : null;
}

function scrollToSection(key: Section | "side") {
  document.getElementById(`tk-sec-${key}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** 처음부터 원문을 펼쳐 둘 문의: 요약만 보고 보내면 안 되는 것(P1·안전·설비 정지·복합·상세 검토) */
function riskyOf(subs: SubTicket[]): boolean {
  return subs.length > 1 || subs.some((x) => x.sub_ticket.priority === "P1" || x.sub_ticket.urgency_flag === "SAFETY" || x.sub_ticket.urgency_flag === "SITE_DOWN" || x.review_depth === "DEEP");
}

export function TicketPage({ ticketId, agent, onBack, navigate }: { ticketId: string; agent: string; onBack: (message?: string) => void; navigate?: (path: string) => void }) {
  const { mode } = useSession();
  const asOf = mode === "snapshot" ? SNAPSHOT : null;
  const query = useTicket(ticketId, asOf);
  const refresh = useRefresh(ticketId);
  const depts = useDepartments();
  const order = inboxOrder(); // 접수함이 마지막으로 보여 준 순서
  const index = order.indexOf(ticketId);
  const goTo = (id: string) => navigate?.(`/tickets/${encodeURIComponent(id)}`);
  // 단축키 j 다음 문의 · k 이전 문의 (글을 쓰는 중이거나 창이 열려 있으면 쓰지 않는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "j" && index >= 0 && index < order.length - 1) goTo(order[index + 1]);
      else if (e.key === "k" && index > 0) goTo(order[index - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const wanted = useRef<Section | null>(sectionFromUrl());
  const loaded = !!query.data;
  useEffect(() => {
    if (loaded && wanted.current) { const k = wanted.current; wanted.current = null; setTimeout(() => scrollToSection(k)); }
  }, [loaded]);
  // 열어 둔 문의 탭 막대(변경 add-ticket-look): 불러온 문의를 요약과 함께 기억한다
  const tabSum = query.data ? (query.data.sub_tickets.find((x) => x.sub_ticket.summary_ko)?.sub_ticket.summary_ko ?? query.data.ticket.inquiry_subject ?? "") : null;
  useEffect(() => { if (tabSum !== null) rememberOpenTab(ticketId, tabSum.slice(0, 40)); }, [ticketId, tabSum]);
  const [sendKind, setSendKind] = useState<Draft["message_type"] | null>(null);
  const [sideTab, setSideTab] = useState<Side | null>(sectionFromUrl() === "customer" ? "customer" : sectionFromUrl() === "system" ? "judge" : null); // null = 문의에 따라 정한다
  const [historyOpen, setHistoryOpen] = useState(sectionFromUrl() === "history");
  const notes = useQuery({ queryKey: ["notes", ticketId], queryFn: () => api.notes(ticketId) });
  const [focus, setFocus] = useState<string | null>(null);
  const [why, setWhy] = useState<EvidenceRow | null>(null);
  const [source, setSource] = useState<SourceTarget | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState<SubTicket | null>(null);
  const [replying, setReplying] = useState(false);
  const [escalating, setEscalating] = useState(false);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  if (notFound) {
    return (
      <EmptyState title={`티켓을 찾을 수 없습니다 ${ticketId}`}>
        <Button onClick={() => onBack()}>접수함으로</Button>
      </EmptyState>
    );
  }
  const detail = query.data;
  if (!detail) {
    if (query.isError) return <Banner tone="neg" action={<Button size="sm" onClick={() => void query.refetch()}>새로고침</Button>}>불러오지 못함. 새로고침</Banner>;
    return <div className="tk" aria-busy="true"><div className="tk-head tk-skeleton" /><div className="tk-tabs tk-skeleton" /></div>;
  }

  const subs = detail.sub_tickets;
  const closed = subs.length > 0 && subs.every((s) => s.sub_ticket.status === "CLOSED");
  const locked = detail.processing || closed;
  const stale = query.isError; // 다시 읽기 실패: 이전 값을 흐리게 둔다

  async function action(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setFail(e instanceof ApiError ? e.message : fallback);
    } finally {
      setBusy(false);
      void refresh();
    }
  }
  const reprocess = () => void action(() => api.reprocess(ticketId), "다시 처리 실패");
  const edit = (sub: SubTicket, data: Record<string, unknown>) =>
    void action(() => api.edit(sub.sub_ticket.sub_ticket_id, { ...data, expected_version: sub.version }), "저장 실패");
  const done = (close: () => void) => () => { close(); void refresh(); };

  // R-00 [이관]: IN_PROGRESS인 하위 문의가 있을 때만(FR-033 처리 1). 모두 이관됐으면 "이미 이관됨"
  const canEscalate = subs.some((s) => s.sub_ticket.status === "IN_PROGRESS");
  const escalatedTo = subs.map((s) => s.sub_ticket.escalated_to).filter(Boolean);
  const escalateTitle = canEscalate ? "전문 부서로 이관(FR-033)"
    : escalatedTo.length ? `이미 이관됨(${escalatedTo.join(", ")})` : "처리 중인 문의만 이관할 수 있음";
  // P6 회신 시각 검사 기준: 마지막으로 보낸 정보 요청 시각
  const infoSentAt = subs.flatMap((s) => s.drafts).filter((d) => d.message_type === "INFO_REQUEST" && d.sent)
    .map((d) => d.sent!.sent_at_utc).sort().pop() ?? null;
  const canReply = !locked && subs.some((s) => s.sub_ticket.status === "WAITING_CUSTOMER");

  const side: Side = sideTab ?? (riskyOf(subs) ? "customer" : "judge");
  const showSide = (tab: Side) => { setSideTab(tab); setTimeout(() => scrollToSection("side")); };
  const jump = (rowId: string) => { setSideTab("judge"); setFocus(null); setTimeout(() => { setFocus(rowId); scrollToSection("side"); }); };
  const processingPane = (
    <div className="tk-pane"><p className="tk-busy" role="status" data-testid="processing">처리 중. 끝나면 자동으로 채워집니다</p></div>
  );

  return (
    <div className={stale ? "tk is-stale" : "tk"} data-testid="ticket-page">
      {stale && (
        <Banner tone="neg" action={<Button size="sm" onClick={() => void query.refetch()}>새로고침</Button>}>불러오지 못함. 새로고침</Banner>
      )}
      {navigate && <OpenTabs current={ticketId} navigate={navigate} />}
      <HeadCard detail={detail} onBack={() => onBack()} onReprocess={reprocess} busy={busy}
                nav={navigate ? { ids: order, index, go: goTo } : undefined}
                onEvidence={() => showSide("judge")} onOriginal={() => showSide("customer")}
                escalate={subs.some((x) => x.writer === "CS") ? { disabled: locked || busy || !canEscalate, title: escalateTitle, onClick: () => setEscalating(true) } : undefined} />
      <NowStrip detail={detail} onShowSend={() => { scrollToSection("send"); setSendKind("INFO_REQUEST"); }}
                deptName={(code) => depts.data?.find((d) => d.dept_code === code)?.dept_name_ko ?? code ?? "담당 부서"} />
      <div className="tk-body">
        <div className="tk-cols tk-cols--work">
          <section id="tk-sec-send" className="tk-sec" aria-label="답변 초안">
            <h2 className="tk-sec__h">답변 초안</h2>
            {detail.processing ? processingPane : (
              <SendTab detail={detail} agent={agent} kind={sendKind} onKind={setSendKind}
                       onSource={setSource} onJump={jump} onFail={setFail} refresh={refresh} />
            )}
          </section>
          <section id="tk-sec-side" className="tk-sec tk-side" aria-label="판단과 고객 원문">
            <div className="tk-side__tabs" role="tablist" aria-label="오른쪽 칸">
              <button type="button" role="tab" aria-selected={side === "judge"} className={side === "judge" ? "is-on" : undefined} onClick={() => setSideTab("judge")}>판단과 근거</button>
              <button type="button" role="tab" aria-selected={side === "customer"} className={side === "customer" ? "is-on" : undefined} onClick={() => setSideTab("customer")}>고객이 보낸 것</button>
            </div>
            {side === "judge" ? (
              <section id="tk-sec-system" aria-label="시스템이 판단한 것">
                {detail.processing ? processingPane : (
                  <SystemTab detail={detail} locked={locked || busy} focus={focus} onWhy={setWhy} onSource={setSource}
                             onAdjust={setAdjusting} onEdit={edit} />
                )}
              </section>
            ) : (
              <section id="tk-sec-customer" aria-label="고객 문의 원문">
                <CustomerTab detail={detail} />
              </section>
            )}
          </section>
        </div>
        <details className="tk-fold" id="tk-fold-memo">
          <summary>내부 메모 <span className="tk-fold__n">{notes.data?.length ?? 0}</span><span className="tk-fold__hint">고객에게 보이지 않습니다</span></summary>
          <MemoCard ticketId={ticketId} agent={agent} />
        </details>
        <details className="tk-fold" id="tk-sec-history" open={historyOpen} onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}>
          <summary>이력</summary>
          <section aria-label="이력">
            <HistoryTab ticketId={ticketId} canReply={canReply} onReply={() => setReplying(true)}
                        escalated={new Map(subs.filter((x) => x.sub_ticket.status === "ESCALATED").map((x) => [x.sub_ticket.seq, x.sub_ticket.sub_ticket_id]))}
                        onMailReply={(subId) => void action(() => api.deptReply(subId, MAIL_REPLY_DEMO, true), "회신을 반영하지 못함")} />
          </section>
        </details>
      </div>

      {why && <WhyPopup label={why.label} why={{ 결과: why.result, 근거: why.evidence, ...why.why }} onClose={() => setWhy(null)}
        onRule={navigate && ruleLink(why.why) ? () => navigate(ruleLink(why.why)!) : undefined} />}
      {source && <SourcePopup target={source} onClose={() => setSource(null)} />}
      {fail && <FailPopup message={fail} onRefresh={() => void refresh()} onClose={() => setFail(null)} />}
      {adjusting && <AdjustPopup sub={adjusting} onClose={() => setAdjusting(null)} onDone={done(() => setAdjusting(null))} />}
      {escalating && <EscalatePopup subs={subs} onClose={() => setEscalating(false)} onDone={done(() => setEscalating(false))} />}
      {replying && (
        <ReplyPopup ticketId={ticketId} language={detail.ticket.language} subs={subs} sentAt={infoSentAt}
                    onClose={() => setReplying(false)} onDone={done(() => setReplying(false))} />
      )}
    </div>
  );
}

/** 「왜?」의 규칙 행이 규칙 관리 화면 어느 탭·행인지(SCR-08 "규칙표에서 보기", 변경 add-reference-views 결정 4) */
function ruleLink(why: unknown): string | null {
  const rule = (why as { rule?: Record<string, unknown> } | null)?.rule;
  if (!rule || typeof rule.rule_id !== "string") return null;
  const tab = "rule_order" in rule ? null : "primary_dept" in rule ? "route" : undefined;
  if (tab === undefined) return null;
  return `/rules?${tab ? `tab=${tab}&` : ""}rule=${encodeURIComponent(rule.rule_id)}`;
}

