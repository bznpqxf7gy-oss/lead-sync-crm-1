import { useNavigate } from "react-router-dom";
import { Inbox, MoonStar, UserCheck, UserX } from "lucide-react";
import { slug } from "@/lib/api";
import { Reveal } from "@/components/TiltCard";

const Stat = ({ icon: Icon, label, value, color, testId }) => (
  <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,.7)", border: "1px solid var(--line)" }}>
    <div className="kpi-icon" style={{ background: color, color, width: 34, height: 34 }}><Icon size={16} color="#fff" /></div>
    <div><p className="display text-2xl font-bold m-0 leading-none" data-testid={testId}>{value}</p><p className="text-xs m-0 mt-1" style={{ color: "var(--muted)" }}>{label}</p></div>
  </div>
);

export function DayBreakdown({ data, label }) {
  const navigate = useNavigate();
  const { day } = data;
  const single = data.start && data.start === data.end;
  const max = Math.max(1, ...day.by_bdm.map((b) => b.count));
  return (
    <Reveal delay={0.1} className="glass panel mb-6">
      <div data-testid="day-breakdown">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
          <div><p className="eyebrow m-0">{label}</p><h3 className="panel-title">Leads arrived & assignment</h3></div>
          <p className="text-xs m-0" style={{ color: "var(--muted)" }}>Leads after 6:00 pm count for the next office day (10 am – 6 pm).</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat icon={Inbox} label="Leads arrived" value={day.arrived} color="#1e63e9" testId="day-arrived" />
          <Stat icon={UserCheck} label="Assigned to BDMs" value={day.assigned} color="#0e9f77" testId="day-assigned" />
          <Stat icon={UserX} label="Left unassigned" value={day.unassigned} color="#d9455f" testId="day-unassigned" />
          <Stat icon={MoonStar} label={single ? "From previous evening (after 6 pm)" : "Arrived after 6 pm"} value={day.after_hours} color="#3d4bc9" testId="day-after-hours" />
        </div>
        {day.by_bdm.length === 0 ? <p className="text-sm m-0" style={{ color: "var(--muted)" }}>No leads assigned in this period yet.</p> : (
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
            {day.by_bdm.map((b) => (
              <button key={b.bdm} onClick={() => navigate(`/leads?bdm=${encodeURIComponent(b.bdm)}${single ? `&date=${data.end}` : ""}`)} className="grid grid-cols-[110px_1fr_36px] items-center gap-3 text-sm text-left" data-testid={`day-bdm-${slug(b.bdm)}`}>
                <span className="truncate font-semibold">{b.bdm}{day.off.includes(b.bdm) && <span className="pill tone-slate ml-1">off</span>}</span>
                <div className="bar"><i style={{ width: `${(b.count / max) * 100}%` }} /></div>
                <strong className="mono text-xs text-right">{b.count}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </Reveal>
  );
}
