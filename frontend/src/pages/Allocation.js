import { useEffect, useState } from "react";
import { Play, Save } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/useApi";
import { errorText, http, initials, slug } from "@/lib/api";
import { PageHeader, SkeletonRows } from "@/components/Common";
import { Attendance } from "@/components/Attendance";
import { Reveal } from "@/components/TiltCard";

function RuleCard({ rule, treatments, today, open, onChange, delay }) {
  const toggle = (t) => onChange({ ...rule, priorities: rule.priorities.includes(t) ? rule.priorities.filter((p) => p !== t) : [...rule.priorities, t] });
  const pct = rule.daily_quota ? Math.min(100, (today / rule.daily_quota) * 100) : 0;
  const id = slug(rule.bdm);
  return (
    <Reveal delay={delay} className={`glass panel ${rule.active ? "" : "opacity-60"}`}><div data-testid={`allocation-card-${id}`}>
      <div className="flex items-center gap-3 mb-5">
        <div className="avatar">{initials(rule.bdm)}</div>
        <div className="flex-1"><p className="font-bold m-0 display">{rule.bdm}</p><p className="text-xs m-0" style={{ color: "var(--muted)" }}>{open} open leads</p></div>
        <Switch data-testid={`allocation-active-${id}`} checked={rule.active} onCheckedChange={(v) => onChange({ ...rule, active: v })} />
      </div>
      <label className="label mb-3">Daily quota<input data-testid={`allocation-quota-${id}`} type="number" min={0} max={500} className="field" value={rule.daily_quota} onChange={(e) => onChange({ ...rule, daily_quota: Math.max(0, Number(e.target.value) || 0) })} /></label>
      <div className="flex justify-between text-xs mb-1" style={{ color: "var(--muted)" }}><span>Assigned today</span><span className="mono">{today} / {rule.daily_quota}</span></div>
      <div className="bar mb-5"><i style={{ width: `${pct}%` }} /></div>
      <p className="eyebrow mb-2">Treatment priority (tap in order)</p>
      <div className="flex flex-wrap gap-2">
        {treatments.map((t) => {
          const rank = rule.priorities.indexOf(t);
          return <button key={t} data-testid={`allocation-priority-${id}-${slug(t)}`} className={`chip ${rank >= 0 ? "on" : ""}`} onClick={() => toggle(t)}>{rank >= 0 && <span className="rank">{rank + 1}</span>}{t}</button>;
        })}
      </div>
    </div></Reveal>
  );
}

export default function Allocation() {
  const { data, loading, reload } = useApi("/allocation");
  const [rules, setRules] = useState([]);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { if (data) { setRules(data.rules); setAuto(data.auto_assign); } }, [data]);

  const save = async () => {
    setBusy("save");
    try { await http.put("/allocation", { auto_assign: auto, rules }); toast.success("Allocation rules saved"); reload(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(""); }
  };
  const run = async () => {
    setBusy("run");
    try {
      await http.put("/allocation", { auto_assign: auto, rules });
      const { data: r } = await http.post("/allocation/run");
      toast.success(r.assigned ? `Assigned ${r.assigned} leads` : "No unassigned leads could be allocated");
      reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(""); }
  };

  return (
    <div>
      <PageHeader eyebrow={data ? `${data.unassigned} unassigned open leads` : "Distribution rules"} title="BDM Allocation" subtitle="Every day at 9:55 am, unassigned leads (including last evening's after-6 pm leads) go to present BDMs by treatment priority and daily quota.">
        <label className="glass flex items-center gap-3 px-4 h-10" style={{ borderRadius: 12 }}><Switch data-testid="auto-assign-switch" checked={auto} onCheckedChange={setAuto} /><span className="text-sm font-semibold">Also assign after each 5-min sync</span></label>
        <button data-testid="run-allocation-button" className="btn btn-ghost" onClick={run} disabled={!!busy}><Play size={15} />{busy === "run" ? "Allocating…" : "Run now"}</button>
        <button data-testid="save-allocation-button" className="btn btn-primary" onClick={save} disabled={!!busy}><Save size={15} />{busy === "save" ? "Saving…" : "Save rules"}</button>
      </PageHeader>
      <Attendance />
      {loading && !data ? <SkeletonRows /> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {rules.map((r, i) => (
            <RuleCard key={r.bdm} rule={r} delay={i * 0.04} treatments={data.treatments} today={data.assigned_today[r.bdm] || 0} open={data.open_load[r.bdm] || 0} onChange={(nr) => setRules(rules.map((x) => (x.bdm === nr.bdm ? nr : x)))} />
          ))}
        </div>
      )}
    </div>
  );
}
