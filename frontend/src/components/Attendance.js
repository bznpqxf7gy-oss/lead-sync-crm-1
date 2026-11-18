import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/useApi";
import { errorText, http, slug, todayIST } from "@/lib/api";

export function Attendance() {
  const [date, setDate] = useState(todayIST());
  const { data, reload } = useApi("/attendance", { date });
  const [off, setOff] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setOff(data.bdms.filter((b) => !b.present).map((b) => b.bdm)); }, [data]);
  const toggle = (bdm) => setOff(off.includes(bdm) ? off.filter((b) => b !== bdm) : [...off, bdm]);
  const save = async () => {
    setBusy(true);
    try { await http.put("/attendance", { date, off }); toast.success("Attendance saved"); reload(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="glass panel mb-6" data-testid="attendance-panel">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div><p className="eyebrow m-0">Rotational offs</p><h3 className="panel-title">Who is in the office?</h3>
          <p className="text-xs m-0 mt-1" style={{ color: "var(--muted)" }}>Leads are auto-assigned at 9:55 am only to BDMs marked present. Tap a name to mark them off.</p></div>
        <div className="flex gap-2">
          <input data-testid="attendance-date-input" type="date" className="field" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
          <button data-testid="attendance-save-button" className="btn btn-primary" onClick={save} disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(data?.bdms || []).map(({ bdm }) => {
          const isOff = off.includes(bdm);
          return <button key={bdm} data-testid={`attendance-${slug(bdm)}`} onClick={() => toggle(bdm)} className={`chip ${isOff ? "" : "on"}`}>{bdm} · {isOff ? "Off" : "Present"}</button>;
        })}
      </div>
    </div>
  );
}
