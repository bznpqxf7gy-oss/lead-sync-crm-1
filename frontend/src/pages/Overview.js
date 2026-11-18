import { useNavigate, useSearchParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlarmClock, CalendarCheck, CalendarDays, Flame, HeartPulse, Users } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { fmtDate, slug, todayIST } from "@/lib/api";
import { TiltCard, Reveal } from "@/components/TiltCard";
import { PageHeader, StagePill } from "@/components/Common";
import { DayBreakdown } from "@/components/DayBreakdown";

const PERIODS = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"], ["all", "All time"], ["date", "Pick date"]];

export function rangeLabel(d) {
  if (!d) return "";
  const short = (x) => fmtDate(x).slice(0, 6);
  if (d.period === "today") return `Today · ${fmtDate(d.end)}`;
  if (d.period === "date") return fmtDate(d.end);
  if (d.period === "week") return `This week · ${short(d.start)} – ${short(d.end)}`;
  if (d.period === "month") return new Date(`${d.start}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  if (d.period === "year") return d.start.slice(0, 4);
  return "All time";
}

function PeriodPicker({ period, setPeriod, date, setDate }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="period-picker">
      <div className="glass flex flex-wrap p-1 gap-1" style={{ borderRadius: 14 }}>
        {PERIODS.map(([key, label]) => (
          <button key={key} data-testid={`period-${key}-button`} onClick={() => setPeriod(key)} className={`chip border-0 ${period === key ? "on" : ""}`}>{key === "date" && <CalendarDays size={13} />}{label}</button>
        ))}
      </div>
      {period === "date" && <input data-testid="overview-date-input" type="date" className="field" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />}
    </div>
  );
}

const KPIS = [
  { key: "total_leads", label: "Leads arrived", icon: Users, color: "#1e63e9" },
  { key: "all_time_leads", label: "All-time leads (total)", icon: CalendarDays, color: "#10a3c4" },
  { key: "hot_pipeline", label: "Hot pipeline", icon: Flame, color: "#d98a12" },
  { key: "surgeries_done", label: "Surgeries done", icon: HeartPulse, color: "#0e9f77" },
  { key: "due_today", label: "Due today (live)", icon: CalendarCheck, color: "#3d4bc9" },
  { key: "overdue", label: "Overdue now (live)", icon: AlarmClock, color: "#d9455f" },
];

function Kpis({ data }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      {KPIS.map(({ key, label, icon: Icon, color }, i) => (
        <TiltCard key={key} delay={i * 0.05} className="kpi">
          <div className="kpi-icon" style={{ background: color, color }}><Icon size={18} color="#fff" /></div>
          <p className="kpi-value" data-testid={`kpi-${slug(label)}`}>{data ? data[key].toLocaleString("en-IN") : "—"}</p>
          <p className="text-xs font-semibold mt-2 mb-0" style={{ color: "var(--muted)" }}>{label}</p>
        </TiltCard>
      ))}
    </div>
  );
}

function Breakdown({ title, eyebrow, rows, total, renderLabel, testId }) {
  return (
    <TiltCard intensity={3} className="panel" data-testid={testId}>
      <p className="eyebrow m-0">{eyebrow}</p><h3 className="panel-title mb-5">{title}</h3>
      <div className="grid gap-4">
        {rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[120px_1fr_44px] items-center gap-3 text-sm">
            <span className="truncate">{renderLabel ? renderLabel(r.name) : r.name}</span>
            <div className="bar"><i style={{ width: `${Math.max(2, (r.count / Math.max(1, total)) * 100)}%` }} /></div>
            <strong className="mono text-right text-xs">{r.count}</strong>
          </div>
        ))}
      </div>
    </TiltCard>
  );
}

const trendLabel = (t, unit) => (unit === "month" ? new Date(`${t.date}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : fmtDate(t.date).slice(0, 6));

function Trend({ data }) {
  return (
    <TiltCard intensity={3} className="panel lg:col-span-2" data-testid="trend-chart">
      <p className="eyebrow m-0">{["today", "date"].includes(data.period) ? "Last 14 office days with leads" : `${rangeLabel(data)} · per ${data.trend_unit}`}</p><h3 className="panel-title mb-4">Lead momentum</h3>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.trend.map((t) => ({ ...t, label: trendLabel(t, data.trend_unit) }))} margin={{ left: -20, right: 8, top: 8 }}>
            <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1e63e9" stopOpacity={0.35} /><stop offset="100%" stopColor="#1e63e9" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="rgba(30,99,233,.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6a7f9b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#6a7f9b" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid rgba(20,60,120,.1)", fontSize: 12 }} />
            <Area type="monotone" dataKey="count" name="Leads" stroke="#1e63e9" strokeWidth={2.5} fill="url(#lg)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </TiltCard>
  );
}

function Leaderboard({ rows, data }) {
  const navigate = useNavigate();
  return (
    <Reveal delay={0.2} className="glass overflow-hidden mt-6" >
      <div className="panel pb-2"><p className="eyebrow m-0">Team performance · {rangeLabel(data)}</p><h3 className="panel-title">BDM leaderboard</h3></div>
      <div className="overflow-x-auto"><table className="table" data-testid="bdm-leaderboard"><thead><tr><th>BDM</th><th>Total leads</th><th>Hot / OPD</th><th>Surgeries</th><th>Lost</th><th>Win rate</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.bdm} className="clickable" onClick={() => navigate(`/leads?bdm=${encodeURIComponent(r.bdm)}${data.start && data.start === data.end ? `&date=${data.end}` : ""}`)} data-testid={`leaderboard-row-${slug(r.bdm)}`}>
            <td><strong>{r.bdm}</strong></td><td className="mono">{r.total}</td><td className="mono">{r.hot}</td><td className="mono">{r.won}</td><td className="mono">{r.lost}</td>
            <td className="mono">{r.total ? ((r.won / r.total) * 100).toFixed(1) : "0.0"}%</td>
          </tr>))}</tbody></table></div>
    </Reveal>
  );
}

export default function Overview() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const period = params.get("period") || "today";
  const date = params.get("date") || "";
  const setPeriod = (p) => setParams((prev) => { const n = new URLSearchParams(prev); n.set("period", p); if (p === "date" && !n.get("date")) n.set("date", todayIST()); return n; }, { replace: true });
  const setDate = (d) => setParams((prev) => { const n = new URLSearchParams(prev); n.set("date", d); return n; }, { replace: true });
  const { data, error, loading } = useApi("/overview", { period, date: period === "date" ? date : "" });
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} title={`${greet}, ${user.name}.`} subtitle={user.role === "BDM" ? "Here's your personal pipeline for the selected period." : "Here's what's moving across the Surgiassist team."}>
        <PeriodPicker period={period} setPeriod={setPeriod} date={date} setDate={setDate} />
      </PageHeader>
      {error && <p className="tone-rose rounded-xl px-3 py-2 text-sm" data-testid="overview-error">{error}</p>}
      <p className="eyebrow mb-3" data-testid="period-label">Showing · {rangeLabel(data)}{loading ? " · updating…" : ""}</p>
      <Kpis data={data} />
      {data && <DayBreakdown data={data} label={rangeLabel(data)} />}
      {data && (
        <>
          <div className="grid lg:grid-cols-3 gap-4">
            <Trend data={data} />
            <Breakdown testId="treatment-breakdown" eyebrow={`Treatments · ${rangeLabel(data)}`} title="Treatment mix" rows={data.by_treatment} total={data.total_leads} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <Breakdown testId="stage-breakdown" eyebrow={`Pipeline · ${rangeLabel(data)}`} title="Where leads stand" rows={data.by_stage} total={data.total_leads} renderLabel={(n) => <StagePill stage={n} />} />
            {data.leaderboard.length > 0 ? <Leaderboard rows={data.leaderboard} data={data} /> : <div />}
          </div>
        </>
      )}
    </div>
  );
}
