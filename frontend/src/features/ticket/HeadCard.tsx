// SCR-03 머리 카드 H-01~H-05와 경고 띠 H-03. 배치는 목업 v1.42 `viewTicket`의 .obj-head(제목 줄 + 숫자 6칸)와 .strip.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, type Detail, type SubTicket } from "../../api";
import { CATEGORY, CHANNEL, DEPTH, DEPTH_HINT, label, NEXT_HINT, STATUS } from "../../app/labels";
import { Icon } from "../../app/icons";
import { Button, Chip, formatLeft } from "../../ui";

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** 대표 문의: 서버 요약(가장 급한 문의)이 고른 것, 없으면 첫 문의 */
export function repOf(detail: Detail): SubTicket | undefined {
  return detail.sub_tickets.find((s) => s.sub_ticket.sub_ticket_id === detail.summary?.rep_sub_ticket_id) ?? detail.sub_tickets[0];
}

/** 접수 줄 오른쪽의 기한 문장(목업 "해결 기한 6일 10시간 초과"). 1차 응답은 아직 안 보냈을 때만 */
function SlaLine({ sub }: { sub: SubTicket }) {
  const sla = sub.sla;
  const status = sub.sub_ticket.status;
  if (!sla || status === "RESOLVED" || status === "CLOSED") return null;
  const frLeft = !sub.sub_ticket.first_response_at_utc && sla.fr_status !== "MET" && sla.fr_target_h !== null
    ? sla.fr_target_h - (num(sla.fr_elapsed_h) ?? 0) : null;
  const resLeft = status === "WAITING_CUSTOMER" || sla.res_target_h === null ? null : (num(sla.remaining_h) ?? sla.res_target_h - (num(sla.res_elapsed_h) ?? 0));
  return (
    <>
      {frLeft !== null && <b className={frLeft < 0 ? "tk-sla is-bad" : "tk-sla"} data-testid="sla-fr">1차 응답 기한 {formatLeft(frLeft)}</b>}
      {status === "WAITING_CUSTOMER" ? <b className="tk-sla" data-testid="sla-res">해결 기한 멈춤(고객 회신 대기)</b>
        : resLeft !== null && <b className={resLeft < 0 ? "tk-sla is-bad" : "tk-sla"} data-testid="sla-res">해결 기한 {formatLeft(resLeft)}</b>}
    </>
  );
}

export interface InboxNav { ids: string[]; index: number; go: (ticketId: string) => void }

export function HeadCard({ detail, onBack, onReprocess, busy, nav, onEvidence, onOriginal, escalate }: {
  detail: Detail; onBack: () => void; onReprocess: () => void; busy: boolean; nav?: InboxNav;
  onEvidence?: () => void;
  /** [원문 보기]: 오른쪽 칸을 "고객이 보낸 것"(원문·번역)으로 바꾼다 */
  onOriginal?: () => void;
  /** [이관]: 부서 작성 영역만 있는 문의면 undefined(버튼 없음) */
  escalate?: { disabled: boolean; title: string; onClick: () => void };
}) {
  const { ticket, run, summary } = detail;
  const subs = detail.sub_tickets;
  const rep = repOf(detail);
  const kinds = [...new Set(subs.map((s) => s.sub_ticket.category_code).filter(Boolean))].map((c) => label(CATEGORY, c));
  const products = [...new Set(subs.map((s) => s.sub_ticket.product_code).filter(Boolean))];
  const closed = subs.length > 0 && subs.every((s) => s.sub_ticket.status === "CLOSED");

  // H-04: 처리 중 / 자동 처리 실패({단계} — {사유}) / 완료
  const failReason = subs.find((s) => s.sub_ticket.pipeline_error)?.sub_ticket.pipeline_error ?? "";
  const runLine = detail.processing ? <Chip tone="info">처리 중</Chip>
    : run?.status === "FAILED" ? <Chip tone="neg">자동 처리 실패: {run.last_step ?? ""}{failReason ? ` — ${failReason}` : ""}</Chip>
    : run?.status === "PARTIAL" ? <Chip tone="crit">일부 문의 처리 실패</Chip>
    : null;

  return (
    <section className="tk-head" aria-label="티켓 요약">
      <div className="tk-head__top">
        <button type="button" className="tk-backcircle" aria-label="접수함으로" title="접수함으로" onClick={onBack}><Icon name="back" /></button>
        <h1 className="tk-head__id">{ticket.ticket_id}</h1>
        <Chip tone={detail.processing ? "info" : "brand"}>{label(STATUS, summary?.status ?? rep?.sub_ticket.status)}</Chip>
        <span className="tk-head__ttl">{[kinds.join(" + ") || "유형 미정", products.join(", ") || "제품 미확인"].join(", ")}</span>
        <span className="tk-head__co" title={ticket.company_masked}>{ticket.company_masked}</span>
        {ticket.customer_tier && <b className="tk-head__tier">{ticket.customer_tier}</b>}
        <span className="tk-head__chips">
          {subs.length > 1 && <Chip tone="brand">복합 문의 {subs.length}건</Chip>}
          {ticket.source_ticket_id && <Chip tone="outline">원본 {ticket.source_ticket_id}</Chip>}
          {ticket.gold_set && <Chip tone="neu">채점용 문의</Chip>}
          {closed && <Chip tone="neu">종료된 문의입니다</Chip>}
          {runLine}
        </span>
        <span className="tk-head__actions">
          {nav && nav.ids.length > 0 && nav.index >= 0 && (
            <span className="tk-nav" role="group" aria-label="이전·다음 문의">
              <button type="button" disabled={nav.index === 0} aria-label="이전 문의 (k)" title="이전 문의 · k" onClick={() => nav.go(nav.ids[nav.index - 1])}>‹</button>
              <span>{nav.index + 1} / {nav.ids.length}</span>
              <button type="button" disabled={nav.index >= nav.ids.length - 1} aria-label="다음 문의 (j)" title="다음 문의 · j" onClick={() => nav.go(nav.ids[nav.index + 1])}>›</button>
            </span>
          )}
          {onEvidence && <Button onClick={onEvidence} title="AI가 어떻게 판단했는지 아래 근거로 이동">근거 전체</Button>}
          {escalate && <Button disabled={escalate.disabled} title={escalate.title} onClick={escalate.onClick}>이관</Button>}
          {(detail.can_reprocess || detail.can_retry) && (
            <Button onClick={onReprocess} busy={busy}>{detail.can_retry ? "다시 시도" : "다시 처리"}</Button>
          )}
        </span>
      </div>
      <p className="tk-recv">
        접수 <b>{ticket.received_at_utc.replace("T", " ").slice(0, 16)}</b> · {label(CHANNEL, ticket.channel)} · {ticket.country ?? "국가 미상"} · 답장 {ticket.language}
        {rep && <SlaLine sub={rep} />}
      </p>
      <div className="tk-sum" data-testid="ai-summary">
        {subs.some((x) => x.sub_ticket.summary_ko) ? (
          <>
            <span className="tk-sum__k" title="AI가 원문을 요약한 것입니다. 원문과 다를 수 있으니 보내기 전에 원문을 확인하세요">AI 요약</span>
            <ul className="tk-sum__list">
              {subs.filter((x) => x.sub_ticket.summary_ko).map((x) => (
                <li key={x.sub_ticket.sub_ticket_id}>{subs.length > 1 ? <b>문의 {x.sub_ticket.seq} · </b> : null}{x.sub_ticket.summary_ko}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <span className="tk-sum__k tk-sum__k--plain">고객 문의</span>
            <ul className="tk-sum__list tk-sum__list--raw"><li title={ticket.inquiry_body}>{(ticket.inquiry_subject ?? ticket.inquiry_body).replace(/\s+/g, " ").slice(0, 160)}</li></ul>
          </>
        )}
        {onOriginal && <Button size="sm" onClick={onOriginal} title="고객이 보낸 원문과 한국어 번역을 오른쪽에서 봅니다">원문 보기</Button>}
      </div>
    </section>
  );
}

/** 자동 발송된 답변의 사후 검수 완료 버튼(변경 add-auto-send-views). 한 번만 되며, 누른 상담원 이름이 기록된다 */
function ReviewButton({ subTicketId }: { subTicketId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const review = useMutation({
    mutationFn: () => api.autoReview(subTicketId),
    onSuccess: () => { setError(""); void qc.invalidateQueries(); },  // 상세·접수함·나의 업무·대시보드가 모두 이 숫자를 쓴다
    onError: (e) => setError(e instanceof ApiError ? e.message : "검수를 기록하지 못했습니다. 다시 시도하세요"),
  });
  return (
    <>
      {error && <span className="tk-neg" role="alert">{error}</span>}
      <Button variant="primary" size="sm" busy={review.isPending} onClick={() => review.mutate()} data-testid="auto-review">사후 검수 완료</Button>
    </>
  );
}

/** 문의 진행 단계. 서버가 준 turn(누구 차례인지)으로 정한다 — 새 값은 없다. 접수·분석·초안은 AI가 해 둔 것 */
function stepsOf(turn: string): { label: string; state: "done" | "cur" | "todo" }[] {
  const mk = (labels: string[], cur: number) => labels.map((label, i) => ({ label, state: (i < cur ? "done" : i === cur ? "cur" : "todo") as "done" | "cur" | "todo" }));
  if (turn === "DONE") return mk(["접수", "분석", "초안", "발송", "고객 회신", "해결"], 6);
  if (turn === "CUSTOMER") return mk(["접수", "분석", "초안", "발송", "고객 회신", "해결"], 4);
  if (turn === "DEPT") return mk(["접수", "분석", "초안", "이관", "부서 회신", "발송"], 4);
  return mk(["접수", "분석", "초안", "상담원 확인", "발송", "고객 회신"], 3);
}

/** 지금 할 일 한 줄(+ 기한 문장, 단계)과 검토 모드. 접수함 줄과 같은 서버 규칙(turn·next_action·review_depth, 변경 add-inbox-turn-depth) */
export function NowStrip({ detail, deptName, onShowSend }: { detail: Detail; deptName: (code: string | null) => string; onShowSend?: () => void }) {
  const rep = repOf(detail);
  if (!rep || detail.processing) return null;
  const done = rep.turn === "DONE";
  const waiting = rep.turn === "DEPT" || rep.turn === "CUSTOMER";
  const pending = detail.sub_tickets.find((s) => s.auto_state === "PENDING");  // 자동 발송했고 사후 검수 전인 문의(변경 add-auto-send-views)
  const shown = pending ?? rep;
  const text = shown.next_action === "WAIT_DEPT"
    ? `${deptName(shown.sub_ticket.escalated_to)} 회신 대기 — ${NEXT_HINT.WAIT_DEPT}` : label(NEXT_HINT, shown.next_action);
  const band = alertBand(detail);
  return (
    <section className={`tk-now tk-now--${pending ? "me" : done ? "done" : waiting ? "wait" : "me"}`} aria-label="지금 할 일" data-testid="now-strip">
      <span className="tk-now__k">{pending ? "내 차례" : done ? "완료" : waiting ? "대기" : "내 차례"}</span>
      <span className="tk-now__t">{text}</span>
      {pending && <ReviewButton subTicketId={pending.sub_ticket.sub_ticket_id} />}
      {!done && !pending && (
        <span className={`tk-now__depth tk-now__depth--${rep.review_depth.toLowerCase()}`} title={DEPTH_HINT[rep.review_depth]}>
          검토 모드 · {DEPTH[rep.review_depth]}
        </span>
      )}
      {band && (
        <span className={`tk-now__alert tk-now__alert--${band.tone}`} role="alert" data-testid="now-alert">
          <b>{band.title}</b> {band.text}
          {band.showSend && onShowSend && <button type="button" className="tk-link tk-link--b" onClick={onShowSend}>보낼 것 보기</button>}
        </span>
      )}
      <ol className="tk-now__steps" aria-label="진행 단계">
        {stepsOf(rep.turn).map((st, i) => (
          <li key={st.label} className={`is-${st.state}`} aria-current={st.state === "cur" ? "step" : undefined}>
            <span className="tk-now__dot">{st.state === "done" ? "✓" : i + 1}</span>{st.label}
          </li>
        ))}
        <li className="tk-now__scope"><i />AI 처리 범위: {detail.sub_tickets.some((x) => x.auto_state !== "NONE") ? "접수·분석·초안·발송" : "접수·분석·초안"}</li>
      </ol>
    </section>
  );
}

/** H-03 기한 경고 문장. 별도 붉은 띠 대신 "지금 할 일" 띠 안에 넣는다. 1차 응답 경고가 먼저(FR-027), 회신 대기면 안내만 */
function alertBand(detail: Detail): { tone: "neg" | "crit" | "neu"; title: string; text: string; showSend: boolean } | null {
  const rep = repOf(detail);
  if (!rep?.sla) return null;
  const sla = rep.sla;
  const open = rep.alerts.filter((a) => !a.cleared_at_utc).map((a) => a.alert_type);
  const pct = (e: number, t: number) => Math.round((e / t) * 100);
  if (rep.sub_ticket.status === "WAITING_CUSTOMER") return { tone: "neu", title: "고객 회신 대기", text: "해결 시계가 멈춰 있습니다.", showSend: false };
  const fr = open.find((a) => a.startsWith("FR_"));
  if (fr && sla.fr_target_h !== null && !rep.sub_ticket.first_response_at_utc) {
    const e = num(sla.fr_elapsed_h) ?? 0;
    const over = fr.endsWith("BREACHED") || e > sla.fr_target_h; // 경고가 아직 AT_RISK여도 시계가 넘었으면 "지남"
    return { tone: over ? "neg" : "crit", title: over ? "1차 응답 기한 지남" : "1차 응답 기한 임박",
      text: over ? "정보 요청을 먼저 보내면 1차 응답으로 인정됩니다." : `1차 응답 기한 ${sla.fr_target_h} h 중 ${e.toFixed(1)} h가 지났습니다(${pct(e, sla.fr_target_h)} %). 정보 요청을 먼저 보내면 1차 응답으로 인정됩니다.`, showSend: true };
  }
  const r = open.find((a) => a.startsWith("RES_"));
  if (r && sla.res_target_h !== null) {
    const e = num(sla.res_elapsed_h) ?? 0;
    const over = r.endsWith("BREACHED") || e > sla.res_target_h;
    return { tone: over ? "neg" : "crit", title: over ? "해결 기한 지남" : "해결 기한 임박", text: `해결 기한 ${sla.res_target_h} h 중 ${e.toFixed(1)} h가 지났습니다.`, showSend: false };
  }
  return null;
}
