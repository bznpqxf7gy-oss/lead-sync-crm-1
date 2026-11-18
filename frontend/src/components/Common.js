import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { STAGE_TONE, slug } from "@/lib/api";

export const StagePill = ({ stage }) => <span className={`pill tone-${STAGE_TONE[stage] || "slate"}`}>{stage}</span>;

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-6">
      <div>
        <p className="eyebrow mb-2">{eyebrow}</p>
        <h2 className="text-3xl sm:text-4xl font-bold m-0" data-testid="section-title">{title}</h2>
        {subtitle && <p className="text-sm md:text-base mt-2 mb-0" style={{ color: "var(--muted)" }}>{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, testId, className = "" }) {
  return (
    <select data-testid={testId} className={`field ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Empty({ title, text, testId }) {
  return (
    <div className="empty" data-testid={testId}>
      <Inbox size={28} className="mx-auto mb-3" style={{ color: "var(--sky)" }} />
      <p className="font-semibold m-0" style={{ color: "var(--ink)" }}>{title}</p>
      {text && <p className="text-sm mt-1 mb-0">{text}</p>}
    </div>
  );
}

export function Pager({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>
      <span data-testid="pager-summary">{total ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}` : "0 results"}</span>
      <div className="flex items-center gap-2">
        <button data-testid="pager-prev-button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></button>
        <span className="mono text-xs">{page} / {pages}</span>
        <button data-testid="pager-next-button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

export const SkeletonRows = ({ rows = 6 }) => (
  <div className="p-4 grid gap-3">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-10" />)}</div>
);

export const testId = slug;
