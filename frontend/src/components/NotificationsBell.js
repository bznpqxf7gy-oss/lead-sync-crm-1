import { Bell, Check, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApi } from "@/hooks/useApi";
import { fmtDate, http } from "@/lib/api";
import { useEffect } from "react";

export function NotificationsBell() {
  const { data, reload } = useApi("/notifications");
  const navigate = useNavigate();
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  const count = (data?.reminders?.length || 0) + (data?.overdue ? 1 : 0) + (data?.due_today ? 1 : 0);
  const done = async (id) => { await http.post(`/reminders/${id}/done`); reload(); };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-testid="notifications-button" className="icon-btn" aria-label="Notifications"><Bell size={17} />{count > 0 && <span className="dot">{count}</span>}</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 rounded-2xl" data-testid="notifications-panel">
        <div className="p-4 border-b"><p className="eyebrow m-0">Today · {fmtDate(data?.today)}</p><p className="font-bold m-0 mt-1 display">Your action queue</p></div>
        <button data-testid="notif-overdue-link" onClick={() => navigate("/followups")} className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-blue-50 text-left">
          <span className="flex items-center gap-2"><Clock size={15} color="#d9455f" />Overdue follow-ups</span><strong data-testid="notif-overdue-count">{data?.overdue ?? 0}</strong>
        </button>
        <button data-testid="notif-due-link" onClick={() => navigate("/followups")} className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-blue-50 text-left border-b">
          <span className="flex items-center gap-2"><Clock size={15} color="#1e63e9" />Due today</span><strong data-testid="notif-due-count">{data?.due_today ?? 0}</strong>
        </button>
        <div className="max-h-64 overflow-auto">
          {!data?.reminders?.length && <p className="text-xs px-4 py-4 m-0" style={{ color: "var(--muted)" }}>No reminders due. Set one from any lead.</p>}
          {data?.reminders?.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3 border-b last:border-0" data-testid={`reminder-${r.id}`}>
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold m-0 truncate">{r.lead_name}</p><p className="text-xs m-0 mt-0.5" style={{ color: "var(--muted)" }}>{fmtDate(r.date)}{r.note ? ` · ${r.note}` : ""}</p></div>
              <button data-testid={`reminder-done-${r.id}`} onClick={() => done(r.id)} className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Mark reminder done"><Check size={14} /></button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
