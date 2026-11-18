import { useState } from "react";
import { MessageCircle, PlugZap, Send } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/useApi";
import { errorText, http, slug, todayIST } from "@/lib/api";
import { Empty, PageHeader, SkeletonRows } from "@/components/Common";

export default function WhatsApp() {
  const [date, setDate] = useState(todayIST());
  const { data, loading, reload } = useApi("/whatsapp/outbox", { date });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const { data: r } = await http.post("/whatsapp/digest/run"); toast.success(`Prepared ${r.messages} messages for today`); setDate(todayIST()); reload(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Daily at 10:00 am" title="WhatsApp morning digest" subtitle="Each present BDM gets their new leads, due and overdue patients when the office opens.">
        <input data-testid="whatsapp-date-input" type="date" className="field" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
        <button data-testid="whatsapp-run-button" className="btn btn-primary" onClick={run} disabled={busy}><Send size={15} />{busy ? "Preparing…" : "Prepare today's messages"}</button>
      </PageHeader>
      <div className="glass p-4 mb-4 flex items-start gap-3 tone-amber" data-testid="whatsapp-not-connected-banner">
        <PlugZap size={18} className="mt-0.5 flex-none" />
        <p className="text-sm m-0">WhatsApp isn't connected yet, so messages are prepared here but <strong>not sent</strong>. Add BDM phone numbers in Team & Access; once you connect a WhatsApp provider they'll go out automatically.</p>
      </div>
      {loading && !data ? <SkeletonRows /> : !data?.items?.length ? <Empty testId="whatsapp-empty" title="No messages for this day" text="They're prepared automatically at 10:00 am, or tap the button above." /> : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.items.map((m) => (
            <div key={m.id} className="glass panel" data-testid={`whatsapp-msg-${slug(m.bdm)}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="kpi-icon" style={{ background: "#0e9f77", color: "#0e9f77", width: 34, height: 34 }}><MessageCircle size={16} color="#fff" /></div>
                <div className="flex-1 min-w-0"><p className="font-bold m-0 display">{m.bdm}</p><p className="text-xs mono m-0" style={{ color: "var(--muted)" }}>{m.to || "No phone number yet"}</p></div>
                <span className="pill tone-slate">Not sent</span>
              </div>
              <div className="flex gap-2 mb-3 text-xs"><span className="pill tone-blue">{m.new_leads} new</span><span className="pill tone-sky">{m.due} due</span><span className="pill tone-rose">{m.overdue} overdue</span></div>
              <pre className="text-xs whitespace-pre-wrap m-0 p-3 rounded-xl max-h-56 overflow-auto" style={{ background: "#e6f6ef", color: "#0b3d2c", fontFamily: "Figtree, sans-serif" }}>{m.message}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
