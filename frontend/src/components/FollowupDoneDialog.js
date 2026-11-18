import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorText, http } from "@/lib/api";

export function FollowupDoneDialog({ lead, onClose, onDone }) {
  const [form, setForm] = useState({ next_date: "", note: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post(`/leads/${lead.id}/followup/complete`, form);
      toast.success(form.next_date ? `Done · next follow-up on ${form.next_date}` : "Follow-up completed");
      setForm({ next_date: "", note: "" });
      onDone();
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl" data-testid="followup-done-dialog">
        <DialogHeader><DialogTitle className="display">Complete follow-up · {lead?.name}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <label className="label">Next follow-up date (leave empty if none)<input data-testid="followup-next-date-input" type="date" className="field" value={form.next_date} onChange={(e) => setForm({ ...form, next_date: e.target.value })} /></label>
          <label className="label">Call outcome<textarea data-testid="followup-note-input" className="field" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. patient will confirm OPD after salary" /></label>
          <button data-testid="followup-done-submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : form.next_date ? "Mark done & schedule next" : "Mark done"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
