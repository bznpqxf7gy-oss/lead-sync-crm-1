import { useCallback, useEffect, useRef, useState } from "react";
import { BellPlus, MapPin, MessageSquarePlus, Phone, Save } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { errorText, fmtDate, fmtDateTime, http } from "@/lib/api";
import { Select, SkeletonRows, StagePill } from "@/components/Common";

function EditPanel({ lead, onSaved }) {
  const { meta, user } = useAuth();
  const [form, setForm] = useState({ stage: lead.stage, bdm: lead.bdm || "Unassigned", follow_up_date: lead.follow_up_date || "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = {};
    if (form.stage !== lead.stage) body.stage = form.stage;
    if (form.follow_up_date !== (lead.follow_up_date || "")) body.follow_up_date = form.follow_up_date;
    if (user.role !== "BDM" && form.bdm !== (lead.bdm || "Unassigned")) body.bdm = form.bdm;
    if (!Object.keys(body).length) { toast.info("No changes to save"); setBusy(false); return; }
    try { await http.patch(`/leads/${lead.id}`, body); toast.success("Lead updated"); onSaved(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="glass p-4 grid gap-3 sm:grid-cols-3">
      <label className="label">Stage<Select testId="drawer-stage-select" value={form.stage} onChange={(v) => setForm({ ...form, stage: v })} options={meta?.stages || []} /></label>
      <label className="label">BDM<Select testId="drawer-bdm-select" value={form.bdm} onChange={(v) => setForm({ ...form, bdm: v })} options={["Unassigned", ...(meta?.bdms || [])]} className={user.role === "BDM" ? "opacity-60 pointer-events-none" : ""} /></label>
      <label className="label">Follow-up date<input data-testid="drawer-followup-input" type="date" className="field" value={form.follow_up_date} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} /></label>
      <button data-testid="drawer-save-button" className="btn btn-primary sm:col-span-3" onClick={save} disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save changes"}</button>
    </div>
  );
}

function Composer({ lead, onSaved }) {
  const [note, setNote] = useState("");
  const [reminder, setReminder] = useState({ date: "", note: "" });
  const addNote = async () => {
    try { await http.post(`/leads/${lead.id}/notes`, { text: note }); setNote(""); toast.success("Note added"); onSaved(); } catch (e) { toast.error(errorText(e)); }
  };
  const addReminder = async () => {
    try { await http.post(`/leads/${lead.id}/reminders`, reminder); setReminder({ date: "", note: "" }); toast.success("Reminder set"); onSaved(); } catch (e) { toast.error(errorText(e)); }
  };
  return (
    <div className="grid gap-3">
      <div className="glass p-4 grid gap-2">
        <p className="eyebrow m-0">Add note</p>
        <textarea data-testid="drawer-note-input" className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call summary, patient concerns, next steps…" />
        <button data-testid="drawer-add-note-button" className="btn btn-ghost justify-self-start" disabled={!note.trim()} onClick={addNote}><MessageSquarePlus size={15} />Add note</button>
      </div>
      <div className="glass p-4 grid gap-2 sm:grid-cols-[150px_1fr_auto] items-end">
        <label className="label">Remind me on<input data-testid="drawer-reminder-date" type="date" className="field" value={reminder.date} onChange={(e) => setReminder({ ...reminder, date: e.target.value })} /></label>
        <label className="label">Reminder note<input data-testid="drawer-reminder-note" className="field" value={reminder.note} onChange={(e) => setReminder({ ...reminder, note: e.target.value })} placeholder="e.g. share OPD slots" /></label>
        <button data-testid="drawer-add-reminder-button" className="btn btn-ghost" disabled={!reminder.date} onClick={addReminder}><BellPlus size={15} />Set</button>
      </div>
    </div>
  );
}

function Timeline({ data }) {
  const { lead, activity, reminders } = data;
  return (
    <div className="glass p-4">
      <p className="eyebrow mb-4">Activity timeline</p>
      {reminders.map((r) => <p key={r.id} className="text-xs tone-amber rounded-lg px-3 py-2 mb-3" data-testid="drawer-reminder-item">Reminder · {fmtDate(r.date)} {r.note && `— ${r.note}`}</p>)}
      <div data-testid="drawer-timeline">
        {activity.map((a) => (
          <div key={a.id} className="timeline-item"><p className="text-sm m-0" style={{ color: "var(--ink)" }}>{a.text}</p><p className="text-[11px] mono m-0 mt-1" style={{ color: "var(--muted)" }}>{a.user_name} · {fmtDateTime(a.created_at)} · {a.type}</p></div>
        ))}
        {lead.comments && <div className="timeline-item"><p className="text-sm m-0" style={{ color: "var(--ink)" }}>{lead.comments}</p><p className="text-[11px] mono m-0 mt-1" style={{ color: "var(--muted)" }}>Sheet comments</p></div>}
        <div className="timeline-item"><p className="text-sm m-0">Lead created from Google Sheets</p><p className="text-[11px] mono m-0 mt-1" style={{ color: "var(--muted)" }}>{fmtDateTime(lead.created_at)}</p></div>
      </div>
    </div>
  );
}

export function LeadDrawer({ leadId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const load = useCallback(async () => {
    if (!leadId) return;
    try { const res = await http.get(`/leads/${leadId}`); setData(res.data); } catch (e) { toast.error(errorText(e)); closeRef.current(); }
  }, [leadId]);
  useEffect(() => { setData(null); load(); }, [leadId, load]);
  const refresh = () => { load(); onChanged?.(); };
  const lead = data?.lead;

  return (
    <Sheet open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" style={{ background: "rgba(244,248,253,.96)" }} data-testid="lead-drawer">
        <SheetHeader className="text-left mb-4">
          <p className="eyebrow m-0">{lead?.lead_id ? `Lead #${lead.lead_id}` : "Lead"}</p>
          <SheetTitle className="text-2xl display" data-testid="drawer-lead-name">{lead?.name || "Loading…"}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap gap-3 text-sm" style={{ color: "var(--ink-2)" }}>
              {lead?.phone && <a href={`tel:+${lead.phone}`} className="flex items-center gap-1" data-testid="drawer-phone"><Phone size={13} />+{lead.phone}</a>}
              {lead?.city && <span className="flex items-center gap-1"><MapPin size={13} />{lead.city}</span>}
              {lead && <StagePill stage={lead.stage} />}
            </div>
          </SheetDescription>
        </SheetHeader>
        {!data ? <SkeletonRows rows={5} /> : (
          <div className="grid gap-3" key={`${lead.id}-${lead.stage}-${lead.bdm}-${lead.follow_up_date}`}>
            <div className="glass p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="eyebrow m-0">Treatment</p><p className="font-semibold m-0 mt-1" data-testid="drawer-treatment">{lead.treatment}</p></div>
              <div><p className="eyebrow m-0">Raw sheet value</p><p className="mono text-xs m-0 mt-1">{lead.raw_treatment || "—"}</p></div>
              <div><p className="eyebrow m-0">Sheet status</p><p className="mono text-xs m-0 mt-1">{lead.sub_status}</p></div>
              <div><p className="eyebrow m-0">Payment</p><p className="m-0 mt-1">{lead.insurance_status || "—"}</p></div>
            </div>
            <EditPanel lead={lead} onSaved={refresh} />
            <Composer lead={lead} onSaved={refresh} />
            <Timeline data={data} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
