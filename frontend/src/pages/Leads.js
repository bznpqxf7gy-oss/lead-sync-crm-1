import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { errorText, fmtDate, fmtDateTime, http } from "@/lib/api";
import { Empty, PageHeader, Pager, Select, SkeletonRows, StagePill } from "@/components/Common";
import { LeadDrawer } from "@/components/LeadDrawer";

const LIMIT = 25;

function Filters({ f, set, meta, isBDM, onClear }) {
  return (
    <div className="glass p-3 mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.6fr_170px_1fr_1fr_1fr_auto]">
      <div className="search"><Search size={15} /><input data-testid="lead-search-input" className="field" placeholder="Search name, phone, city or lead ID" value={f.search} onChange={(e) => set({ search: e.target.value })} /></div>
      <input data-testid="lead-date-filter-input" type="date" className="field" value={f.date} onChange={(e) => set({ date: e.target.value })} aria-label="Office day" title="Office day (leads after 6 pm count for the next day)" />
      <Select testId="lead-treatment-filter" value={f.treatment} onChange={(v) => set({ treatment: v })} options={meta?.treatments || []} placeholder="All treatments" />
      <Select testId="lead-stage-filter" value={f.stage} onChange={(v) => set({ stage: v })} options={meta?.stages || []} placeholder="All stages" />
      {!isBDM ? <Select testId="lead-bdm-filter" value={f.bdm} onChange={(v) => set({ bdm: v })} options={["Unassigned", ...(meta?.bdms || [])]} placeholder="All BDMs" /> : <div className="hidden lg:block" />}
      <button data-testid="clear-filters-button" className="btn btn-ghost" onClick={onClear}><X size={15} />Clear</button>
    </div>
  );
}

function LeadTable({ items, onOpen }) {
  return (
    <div className="overflow-x-auto">
      <table className="table" data-testid="leads-table">
        <thead><tr><th>Patient</th><th>Treatment</th><th>Stage</th><th>BDM</th><th>Follow-up</th><th>Arrived</th></tr></thead>
        <tbody>{items.map((l) => (
          <tr key={l.id} className="clickable" onClick={() => onOpen(l.id)} data-testid={`lead-row-${l.id}`}>
            <td><strong className="block">{l.name}</strong><span className="text-xs mono" style={{ color: "var(--muted)" }}>{l.phone || "No phone"} · {l.city || "—"}</span></td>
            <td><span className="block font-semibold" style={{ color: "var(--ink)" }}>{l.treatment}</span>{l.treatment_variant && <span className="tag mt-1">{l.treatment_variant}</span>}</td>
            <td><StagePill stage={l.stage} /><span className="block text-[11px] mt-1 mono" style={{ color: "var(--muted)" }}>{l.sub_status}</span></td>
            <td>{l.bdm || <span className="pill tone-rose">Unassigned</span>}</td>
            <td className="mono text-xs">{fmtDate(l.follow_up_date)}</td>
            <td className="mono text-xs">{fmtDateTime(l.created_at)}{l.after_hours && <span className="pill tone-indigo mt-1" title="Arrived after 6 pm">Counts {fmtDate(l.office_date).slice(0, 6)}</span>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function Leads() {
  const { meta, user } = useAuth();
  const [params] = useSearchParams();
  const blank = { search: "", date: "", treatment: "", stage: "", bdm: "" };
  const [f, setF] = useState({ ...blank, bdm: params.get("bdm") || "", date: params.get("date") || "" });
  const [q, setQ] = useState(f);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const { data, loading, error, reload } = useApi("/leads", { ...q, page, limit: LIMIT });

  useEffect(() => { const t = setTimeout(() => { setQ(f); setPage(1); }, 300); return () => clearTimeout(t); }, [f]);
  const set = (patch) => setF((prev) => ({ ...prev, ...patch }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await http.get("/leads/export", { params: q, responseType: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(res.data);
      a.download = `surgiassist-leads${q.date ? `-${q.date}` : ""}.csv`;
      a.click();
      toast.success("Export ready");
    } catch (e) { toast.error(errorText(e)); } finally { setExporting(false); }
  };

  return (
    <div>
      <PageHeader eyebrow={`Master sheet · ${data?.total ?? "…"} matching leads`} title="Leads & Pipeline" subtitle="Filter by a single office day (after-6 pm leads count for the next day), treatment, stage or BDM. Click any lead to work it.">
        <button data-testid="export-leads-button" className="btn btn-ghost" onClick={exportCsv} disabled={exporting}><Download size={15} />{exporting ? "Exporting…" : "Export CSV"}</button>
      </PageHeader>
      <Filters f={f} set={set} meta={meta} isBDM={user.role === "BDM"} onClear={() => setF(blank)} />
      <div className="glass overflow-hidden">
        {error && <p className="tone-rose px-4 py-3 text-sm m-0">{error}</p>}
        {loading && !data ? <SkeletonRows /> : data?.items?.length ? <LeadTable items={data.items} onOpen={setOpenId} /> : <Empty testId="leads-empty" title="No leads match these filters" text="Try another date or clear the filters." />}
        {data && <Pager page={page} total={data.total} limit={LIMIT} onPage={setPage} />}
      </div>
      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
