import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { daysBetween, fmtDate, slug, todayIST } from "@/lib/api";
import { Empty, PageHeader, Select, SkeletonRows, StagePill } from "@/components/Common";
import { TiltCard } from "@/components/TiltCard";
import { LeadDrawer } from "@/components/LeadDrawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FollowupDoneDialog } from "@/components/FollowupDoneDialog";

const BUCKETS = [{ key: "overdue", label: "Overdue", color: "#d9455f" }, { key: "due", label: "Due on date", color: "#1e63e9" }, { key: "upcoming", label: "Upcoming", color: "#0e9f77" }];

function BdmBreakdown({ rows, onPick }) {
  const max = Math.max(1, ...rows.map((r) => r.overdue + r.due));
  return (
    <div className="glass overflow-hidden" data-testid="followups-bdm-breakdown">
      <div className="panel pb-2"><p className="eyebrow m-0">Per BDM</p><h3 className="panel-title">Due & overdue breakdown</h3></div>
      <div className="overflow-x-auto"><table className="table"><thead><tr><th>BDM</th><th>Overdue</th><th>Due</th><th>Upcoming</th><th className="w-1/3">Pressure</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.bdm} className="clickable" onClick={() => onPick(r.bdm)} data-testid={`followup-bdm-row-${slug(r.bdm)}`}>
            <td><strong>{r.bdm}</strong></td><td className="mono" style={{ color: r.overdue ? "var(--bad)" : undefined }}>{r.overdue}</td><td className="mono">{r.due}</td><td className="mono">{r.upcoming}</td>
            <td><div className="bar"><i style={{ width: `${((r.overdue + r.due) / max) * 100}%`, background: r.overdue ? "linear-gradient(90deg,#f39aa9,#d9455f)" : undefined }} /></div></td>
          </tr>))}</tbody></table></div>
    </div>
  );
}

function Queue({ items, refDate, onOpen, onDone }) {
  if (!items.length) return <Empty title="Nothing here" text="This queue is clear for the selected date." />;
  return (
    <div className="overflow-x-auto"><table className="table"><thead><tr><th>Patient</th><th>Treatment</th><th>BDM</th><th>Stage</th><th>Follow-up</th><th /></tr></thead>
      <tbody>{items.map((l) => {
        const diff = daysBetween(l.follow_up_date, refDate);
        return (
          <tr key={l.id} className="clickable" onClick={() => onOpen(l.id)} data-testid={`followup-row-${l.id}`}>
            <td><strong className="block">{l.name}</strong><span className="mono text-xs" style={{ color: "var(--muted)" }}>{l.phone}</span></td>
            <td>{l.treatment}</td><td>{l.bdm || "Unassigned"}</td><td><StagePill stage={l.stage} /></td>
            <td className="mono text-xs">{fmtDate(l.follow_up_date)}{diff > 0 && <span className="block" style={{ color: "var(--bad)" }}>{diff}d overdue</span>}</td>
            <td><button data-testid={`followup-done-${l.id}`} className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onDone(l); }}><CheckCircle2 size={14} />Done</button></td>
          </tr>);
      })}</tbody></table></div>
  );
}

export default function Followups() {
  const { meta, user } = useAuth();
  const [date, setDate] = useState(todayIST());
  const [bdm, setBdm] = useState("");
  const [openId, setOpenId] = useState(null);
  const { data, loading, reload } = useApi("/followups", { date, bdm });
  const [doneLead, setDoneLead] = useState(null);

  return (
    <div>
      <PageHeader eyebrow="Action queue" title="Follow-ups" subtitle="Everything due on the selected date, what slipped, and what's coming.">
        <input data-testid="followups-date-input" type="date" className="field" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
        {user.role !== "BDM" && <Select testId="followups-bdm-filter" value={bdm} onChange={setBdm} options={["Unassigned", ...(meta?.bdms || [])]} placeholder="All BDMs" className="w-auto" />}
      </PageHeader>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {BUCKETS.map((b, i) => (
          <TiltCard key={b.key} delay={i * 0.05} className="kpi">
            <p className="eyebrow m-0" style={{ color: b.color }}>{b.label}</p>
            <p className="kpi-value" data-testid={`followups-${b.key}-count`}>{data ? data.summary[b.key] : "—"}</p>
          </TiltCard>
        ))}
      </div>
      {loading && !data ? <SkeletonRows /> : data && (
        <div className="grid xl:grid-cols-[1fr_1.4fr] gap-4 items-start">
          {user.role !== "BDM" ? <BdmBreakdown rows={data.by_bdm} onPick={setBdm} /> : null}
          <div className={`glass overflow-hidden ${user.role === "BDM" ? "xl:col-span-2" : ""}`}>
            <Tabs defaultValue="overdue">
              <div className="p-3 border-b" style={{ borderColor: "var(--line)" }}><TabsList>{BUCKETS.map((b) => <TabsTrigger key={b.key} value={b.key} data-testid={`followups-tab-${b.key}`}>{b.label} · {data.summary[b.key]}</TabsTrigger>)}</TabsList></div>
              {BUCKETS.map((b) => <TabsContent key={b.key} value={b.key} className="mt-0"><Queue items={data[b.key]} refDate={data.date} onOpen={setOpenId} onDone={setDoneLead} /></TabsContent>)}
            </Tabs>
          </div>
        </div>
      )}
      <LeadDrawer leadId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      <FollowupDoneDialog lead={doneLead} onClose={() => setDoneLead(null)} onDone={() => { setDoneLead(null); reload(); }} />
    </div>
  );
}
