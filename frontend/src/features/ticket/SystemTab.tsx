// 탭 ② 시스템이 판단한 것 (SCR-03 C-01~C-10, FR-024, 문의마다 한 칸). 배치는 목업 v1.42 `judgSection`(이름 | 값 | 왜?).
// 유형·긴급도·제품 고치기(FR-030 처리 5), 받은 항목 표시(C-07), 우선순위 [조정](P3), 실행 기록(C-11)도 이 탭에 둔다.
import { useEffect, useRef, useState } from "react";
import { api, type Detail, type EvidenceRow, type FaultCandidate, type RunRow, type SubTicket } from "../../api";
import { CATEGORY, URGENCY, label } from "../../app/labels";
import { Chip, Field, PriorityBadge, SlaBadge, StatusBadge, Button, formatLeft } from "../../ui";
import { Icon } from "../../app/icons";
import { useDepartments } from "../../app/queries";
import type { SourceTarget } from "./Popups";

const CATEGORIES = ["DEFECT", "FW_UPDATE", "MANUAL", "QUOTE", "TECH_SPEC", "COMPLIANCE", "RETURN", "WARRANTY", "INSTALL", "ORDER_LEAD"];
const CHECK_NAMES: Record<string, string> = {
  LOW_CONFIDENCE: "확신 낮음·판정 실패", LANG_UNCERTAIN: "언어 불확실", EXTRACT_FAILED: "추출 실패", PRODUCT_UNKNOWN: "제품 미확정",
  RULE_FAILED: "규칙 판정 실패", RETURN_REASON: "반품 사유 확인 필요", NO_EVIDENCE: "근거 없음", DRAFT_CHECK: "자체 대조 불일치",
};
const METHOD: Record<string, string> = { EXACT: "정확 일치", SYMPTOM: "증상 검색" };

function Edited({ sub, name }: { sub: SubTicket; name: string }) {
  const e = sub.edits[name];
  return e ? <Chip tone="brand" title={`${String(e.from ?? "—")} → ${String(e.to)} (${e.by ?? ""})`}>상담원 수정</Chip> : null;
}

/** 유형·긴급도·제품(·반품 구분) 고치기 → PATCH /sub-tickets/{id}, 저장하면 다시 계산(처리 중) */
function EditControls({ sub, locked, onSave }: { sub: SubTicket; locked: boolean; onSave: (data: Record<string, unknown>) => void }) {
  const st = sub.sub_ticket;
  const [category, setCategory] = useState(st.category_code ?? "");
  const [urgency, setUrgency] = useState(st.urgency_flag);
  const [product, setProduct] = useState(st.product_code ?? "");
  const [returnKind, setReturnKind] = useState(st.return_kind ?? "");
  const [products, setProducts] = useState<{ product_code: string; product_name: string }[]>([]);
  useEffect(() => { api.products().then(setProducts).catch(() => setProducts([])); }, []);

  const changed: Record<string, unknown> = {};
  if (category && category !== st.category_code) changed.category_code = category;
  if (urgency !== st.urgency_flag) changed.urgency_flag = urgency;
  if (product && product !== st.product_code) changed.product_code = product;
  if (returnKind && returnKind !== st.return_kind) changed.return_kind = returnKind;

  return (
    <div className="tk-edit" aria-label={`문의 ${st.seq} 값 고치기`}>
      <Field label="유형">
        <select value={category} disabled={locked} onChange={(e) => setCategory(e.target.value)}>
          {!st.category_code && <option value="">유형을 정하지 못함. 직접 선택</option>}
          {CATEGORIES.map((c) => <option key={c} value={c}>{label(CATEGORY, c)} ({c})</option>)}
        </select>
      </Field>
      <Field label="긴급도">
        <select value={urgency} disabled={locked} onChange={(e) => setUrgency(e.target.value)}>
          {Object.entries(URGENCY).map(([v, l]) => <option key={v} value={v}>{l} ({v})</option>)}
        </select>
      </Field>
      <Field label="제품">
        <select value={product} disabled={locked} onChange={(e) => setProduct(e.target.value)}>
          {!st.product_code && <option value="">제품 확인 필요. 선택</option>}
          {products.map((p) => <option key={p.product_code} value={p.product_code}>{p.product_code}</option>)}
        </select>
      </Field>
      {(category || st.category_code) === "RETURN" && (
        <Field label="반품 구분">
          <select value={returnKind} disabled={locked} onChange={(e) => setReturnKind(e.target.value)}>
            <option value="">{st.return_kind === "UNKNOWN" ? "확인 필요" : "—"}</option>
            <option value="DEFECT">불량</option>
            <option value="NON_DEFECT">비불량</option>
          </select>
        </Field>
      )}
      <Button disabled={locked || !Object.keys(changed).length} onClick={() => onSave(changed)}>저장하고 다시 계산</Button>
    </div>
  );
}

/** C-07 필수정보: ✓ 제공(값) / ● 막는 항목 / ○ 빠짐 / "상담원 입력". 빠진 항목은 [받았음]으로 표시(FR-030 처리 5) */
function Required({ sub, row, locked, onReceived }: {
  sub: SubTicket; row: EvidenceRow; locked: boolean; onReceived: (field: string, value: string) => void;
}) {
  const [value, setValue] = useState<Record<string, string>>({});
  return (
    <ul className="tk-items" data-testid={`required-${sub.sub_ticket.seq}`}>
      {(row.items ?? []).map((it) => (
        <li key={it.field} className={`is-${it.state}`} data-field={it.field} data-state={it.state}>
          <span aria-hidden="true">{it.state === "provided" ? "✓" : it.state === "blocking" ? "●" : "○"}</span>
          <span className="tk-items__lab">{it.label}
            <span className="tk-items__sub">{it.state === "provided" ? `제공(${it.value ?? ""})` : it.state === "blocking" ? "막는 항목" : "빠짐"}</span>
            {sub.fields.some((f) => f.field === it.field && f.source === "AGENT") && <Chip tone="brand">상담원 입력</Chip>}</span>
          {it.state !== "provided" && !locked && (
            <>
              <input placeholder="받은 값(선택)" aria-label={`${it.label} 받은 값`} value={value[it.field] ?? ""}
                     onChange={(e) => setValue({ ...value, [it.field]: e.target.value })} />
              <Button size="sm" onClick={() => onReceived(it.field, value[it.field] ?? "")}>받았음</Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Fault({ c }: { c: FaultCandidate }) {
  return (
    <div className="tk-fault">
      <div className="tk-row__line">
        <b>{c.fault_id}</b><Chip tone="outline">{METHOD[c.method ?? ""] ?? "—"}{c.score !== null ? ` ${c.score.toFixed(2)}` : ""}</Chip>
        {c.onsite_required && <Chip tone="neg">현장 출동 필요</Chip>}
        {c.replace_required && <Chip tone="neg">교체 필요</Chip>}
      </div>
      <dl><dt>원인</dt><dd>{c.cause ?? "—"}</dd><dt>점검</dt><dd>{c.check ?? "—"}</dd><dt>조치</dt><dd>{c.action ?? "—"}</dd></dl>
    </div>
  );
}

/** 줄 값 아래에 펼쳐 보이는 것(근거 문장, 절·조회값, 진단·이관 후보) */
function RowBody({ sub, row, onSource }: { sub: SubTicket; row: EvidenceRow; onSource: (t: SourceTarget) => void }) {
  if (row.id === "C-08" && sub.diagnosis) {
    const [first, ...rest] = sub.diagnosis.fault_candidates;
    return (
      <>
        <span className="tk-row__ev">참고용, 초안에는 쓰지 않음{sub.diagnosis.notes.map((n) => ` · ${n}`).join("")}</span>
        {first && <Fault c={first} />}
        {rest.length > 0 && <details className="tk-old"><summary>다른 후보 {rest.length}개</summary>{rest.map((c) => <Fault key={c.fault_id} c={c} />)}</details>}
      </>
    );
  }
  if (row.id === "C-09" && sub.escalation) {
    const list = sub.escalation.escalation_candidates;
    return (
      <span className="tk-row__ev">
        확정은 상담원이 합니다.{" "}
        {list.length === 0 && sub.escalation.escalation_condition && `이관 조건: ${sub.escalation.escalation_condition}`}
        {list.some((c) => c.team) && <Chip tone="brand">팀 규칙 포함</Chip>}
      </span>
    );
  }
  if (row.candidates?.length || row.lookups?.length) {
    return (
      <ul className="tk-items">
        {(row.candidates ?? []).map((c) => (
          <li key={c.chunk_id}>
            <button type="button" className="tk-link" onClick={() => onSource({ kind: "cite", chunk_id: c.chunk_id, text: `(${c.doc_id} §${c.section})`, score: c.score })}>
              {c.doc_id} §{c.section}
            </button>
            <span className="tk-items__sub">“{c.quote}”, 점수 {c.score.toFixed(3)}</span>
          </li>
        ))}
        {(row.lookups ?? []).map((lv, i) => (
          <li key={`l${i}`}>
            <button type="button" className="tk-link" onClick={() => onSource({ kind: "lookup", lookup: lv })}>{lv.item}</button>
            {String(lv.value)} {lv.unit ?? ""}<span className="tk-items__sub">({lv.source_table}: {lv.source_key})</span>
          </li>
        ))}
      </ul>
    );
  }
  return row.evidence.length > 0 ? <span className="tk-row__ev">{row.evidence.map((e) => `“${e}”`).join(" · ")}</span> : null;
}

function RunList({ ticketId }: { ticketId: string }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && runs === null) api.runs(ticketId).then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, [open, runs, ticketId]);
  return (
    <details className="tk-runs" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>실행 기록 보기</summary>
      {runs === null ? <p className="tk-muted">읽는 중…</p> : (
        <table className="ui-table">
          <thead><tr><th>실행</th><th>문의</th><th>계기</th><th>결과</th><th>마지막 단계</th><th>시작</th><th>단계</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td>{r.run_id}</td><td>{r.sub_ticket_id ?? "티켓"}</td><td>{r.trigger}</td>
                <td className={r.status === "FAILED" ? "tk-neg" : undefined}>{r.status ?? "처리 중"}</td><td>{r.last_step ?? "—"}</td>
                <td>{r.started_at_utc.replace("T", " ").slice(0, 19)}</td>
                <td>{r.step_count}{r.failed_steps ? <span className="tk-neg"> (실패 {r.failed_steps})</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

/** 판단 표에 항상 보이는 줄(예전 목업 "판단과 근거"): 이름 | 값 | 돋보기. 나머지는 [근거 더 보기]에 접어 둔다 */
const MAIN_ROWS = ["C-01", "C-02", "C-03", "C-04", "C-06", "C-07"];

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** C-06 SLA 목표 줄: "1차 응답 기한 …"과 "해결 기한 …"을 따로 적는다(팀 검토: 어느 기한인지 구분) */
function SlaValue({ sub }: { sub: SubTicket }) {
  const sla = sub.sla;
  const st = sub.sub_ticket;
  if (!sla) return <span className="tk-muted">SLA 미정</span>;
  const frLeft = !st.first_response_at_utc && sla.fr_status !== "MET" && sla.fr_target_h !== null ? sla.fr_target_h - (num(sla.fr_elapsed_h) ?? 0) : null;
  const resLeft = st.status === "WAITING_CUSTOMER" || sla.res_target_h === null ? null : (num(sla.remaining_h) ?? sla.res_target_h - (num(sla.res_elapsed_h) ?? 0));
  const line = (k: string, left: number | null, target: number | null, done?: boolean) => (
    <span className="tk-sla2"><span className="tk-sla2__k">{k}</span>
      {done ? <Chip tone="pos">보냄</Chip> : left === null ? <span className="tk-muted">{st.status === "WAITING_CUSTOMER" ? "멈춤" : "미정"}</span>
        : <b className={left < 0 ? "tk-neg" : undefined}>{formatLeft(left)}</b>}
      {target !== null && <span className="tk-muted"> / 목표 {target}h</span>}</span>
  );
  return <>{line("1차 응답 기한", frLeft, sla.fr_target_h, !!st.first_response_at_utc || sla.fr_status === "MET")}{line("해결 기한", resLeft, sla.res_target_h)}
    <span className="tk-sr" aria-hidden="true">1차 응답 {sla.fr_target_h}h / 해결 {sla.res_target_h}h</span></>;
}

function JudgeRow({ sub, row, compact, focus, refs, locked, onAdjust, onEdit, onWhy, onSource }: {
  sub: SubTicket; row: EvidenceRow; compact: boolean; focus: string | null; refs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  locked: boolean; onAdjust: (sub: SubTicket) => void; onEdit: (sub: SubTicket, data: Record<string, unknown>) => void;
  onWhy: (row: EvidenceRow) => void; onSource: (t: SourceTarget) => void;
}) {
  const st = sub.sub_ticket;
  const closed = st.status === "CLOSED";
  const adj = sub.adjustments[sub.adjustments.length - 1];
  const depts = useDepartments();
  const deptName = (code: string) => depts.data?.find((d) => d.dept_code === code)?.dept_name_ko ?? code;
  const items = row.items ?? [];
  const needsInput = row.id === "C-07" && items.some((i) => i.state !== "provided");
  return (
    <>
      <div className={[focus === row.id ? "is-focus" : "", "tk-row", compact ? "tk-row--c" : ""].filter(Boolean).join(" ")} data-row={row.id}
           ref={(el) => (refs.current[row.id] = el)}>
        <span className="tk-row__k">{row.label.replace(/^[①-⑩]\s*/, "")}</span>
        <div className="tk-row__v">
          <span className="tk-row__line">
            {row.id === "C-03" ? (
              <>
                <PriorityBadge priority={st.priority} adjusted={!!adj} />
                {compact ? (
                  <>
                    <span className="tk-muted" title={adj ? `${adj.from_priority} → ${adj.to_priority} (상담원 조정, 사유: ${adj.reason})` : undefined}>
                      {adj ? `규칙 ${adj.from_priority} → ${adj.to_priority}` : `규칙 ${st.priority_rule_id ?? "—"}`}
                    </span>
                    <span className="tk-sr" aria-hidden="true">({st.priority_rule_id ?? "—"})</span>
                    {adj && <span className="tk-sr">{adj.from_priority} → {adj.to_priority} (상담원 조정, 사유: {adj.reason})</span>}
                  </>
                ) : (
                  <>
                    <span className="tk-muted">규칙값 {sub.adjustments[0]?.from_priority ?? st.priority ?? "—"} ({st.priority_rule_id ?? "—"})</span>
                    {adj && <span>{adj.from_priority} → {adj.to_priority} (상담원 조정, 사유: {adj.reason})</span>}
                  </>
                )}
                <button type="button" className="tk-link tk-link--b" disabled={locked || closed || !st.priority} onClick={() => onAdjust(sub)}>조정</button>
              </>
            ) : row.id === "C-01" ? (
              <>{row.result.startsWith("없음") ? <span className="tk-muted">{row.result}</span> : <>{label(CATEGORY, row.result)}{!compact ? <> <span className="tk-mono">{row.result}</span></> : <span className="tk-sr" aria-hidden="true"> {row.result}</span>}</>}<Edited sub={sub} name="category_code" /></>
            ) : row.id === "C-02" ? (
              <>{URGENCY[row.result] ?? row.result}{!compact ? <> <span className="tk-mono">{row.result}</span></> : <span className="tk-sr" aria-hidden="true"> {row.result}</span>}<Edited sub={sub} name="urgency_flag" /></>
            ) : row.id === "C-06" && compact ? (
              <SlaValue sub={sub} />
            ) : row.id === "C-07" && compact ? (
              <><b>{items.filter((i) => i.state === "provided").length}/{items.length}</b>
                {needsInput ? <Chip tone={items.some((i) => i.state === "blocking") ? "neg" : "crit"}>{items.some((i) => i.state === "blocking") ? "막는 항목 있음" : "빠진 항목 있음"}</Chip> : <Chip tone="pos">충족</Chip>}</>
            ) : row.id === "C-04" && compact ? (
              <><span title={row.result}>{deptName(row.result)}</span><span className="tk-sr" aria-hidden="true"> {row.result}</span></>
            ) : (
              <span className={row.result.startsWith("없음") ? "tk-muted" : undefined}>{row.result}</span>
            )}
            {row.id === "M-C-01" && <Edited sub={sub} name="product_code" />}
          </span>
          {row.id === "C-07" && items.length ? (
            compact && !needsInput ? (
              <ul className="tk-items tk-items--ok" data-testid={`required-${st.seq}`}>
                {items.map((it) => <li key={it.field} className="is-provided" data-field={it.field} data-state="provided"><span aria-hidden="true">✓</span>{it.label}</li>)}
              </ul>
            ) : (
              <Required sub={sub} row={row} locked={locked || closed}
                        onReceived={(field, value) => onEdit(sub, { received_fields: [{ field, value: value || null }] })} />
            )
          ) : !compact && <RowBody sub={sub} row={row} onSource={onSource} />}
        </div>
        {/* 돋보기: 근거(근거 문장·규칙)는 누르면 창으로 연다. 페이지가 길어지지 않게 한다 */}
        <button type="button" className="tk-why tk-why--icon" aria-label="근거 보기" title="근거 보기" onClick={() => onWhy(row)}><Icon name="search" /></button>
      </div>
    </>
  );
}

export function SystemTab({ detail, locked, focus, onWhy, onSource, onAdjust, onEdit }: {
  detail: Detail; locked: boolean; focus: string | null;
  onWhy: (row: EvidenceRow) => void; onSource: (t: SourceTarget) => void; onAdjust: (sub: SubTicket) => void;
  onEdit: (sub: SubTicket, data: Record<string, unknown>) => void;
  /** [접수 이력에서 보기]: 그 문의의 에러 코드·제품으로 해결사례 검색을 연다(SCR-09 동작 표) */
}) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => { if (focus) refs.current[focus]?.scrollIntoView({ block: "center" }); }, [focus]);
  const n = detail.sub_tickets.length;

  return (
    <div className="tk-pane">
      {detail.sub_tickets.map((sub) => {
        const st = sub.sub_ticket;
        const closed = st.status === "CLOSED";
        return (
          <section key={st.sub_ticket_id} className="tk-sub" aria-label={`문의 ${st.seq}`} data-testid={`judge-${st.seq}`}>
            {n > 1 && (
              <div className="tk-sub__head">
                문의 {st.seq}/{n}: {label(CATEGORY, st.category_code)} <StatusBadge status={st.status} />
                <SlaBadge status={sub.sla?.res_status} />
              </div>
            )}
            {st.pipeline_error && <div className="tk-strip tk-strip--neg"><b>자동 처리 실패</b><span>{st.pipeline_error}</span></div>}
            {(sub.checks.length > 0 || sub.other_flags.length > 0) && (
              <div className="tk-row" ref={(el) => (refs.current["C-10"] = el)} data-row="C-10">
                <span className="tk-row__k">확인 표시</span>
                <span className="tk-row__line">
                  {sub.checks.map((c, i) => <Chip key={i} tone="neg">{CHECK_NAMES[c.check_type] ?? c.check_type}{c.flag ? `: ${c.flag}` : ""}</Chip>)}
                  {sub.other_flags.map((f) => <Chip key={f} tone="neu" title="확인 표시 종류에 없는 표시">기타 표시: {f}</Chip>)}
                </span>
                <span />
              </div>
            )}
            {MAIN_ROWS.map((id) => sub.evidence_rows.find((r) => r.id === id)).filter((r): r is EvidenceRow => !!r).map((row) => (
              <JudgeRow key={row.id} sub={sub} row={row} compact focus={focus} refs={refs} locked={locked} onAdjust={onAdjust} onEdit={onEdit} onWhy={onWhy} onSource={onSource} />
            ))}
            <details className="tk-more" open={!!focus && !MAIN_ROWS.includes(focus)}>
              <summary>근거 더 보기 · 고장 진단 · 이관 후보 · 수정</summary>
              {sub.evidence_rows.filter((r) => !MAIN_ROWS.includes(r.id)).map((row) => (
                <JudgeRow key={row.id} sub={sub} row={row} compact={false} focus={focus} refs={refs} locked={locked} onAdjust={onAdjust} onEdit={onEdit} onWhy={onWhy} onSource={onSource} />
              ))}
              <EditControls key={`${st.sub_ticket_id}-${sub.version}`} sub={sub} locked={locked || closed} onSave={(data) => onEdit(sub, data)} />
              {detail.sub_tickets[0] === sub && <RunList ticketId={detail.ticket.ticket_id} />}
            </details>
          </section>
        );
      })}
    </div>
  );
}
