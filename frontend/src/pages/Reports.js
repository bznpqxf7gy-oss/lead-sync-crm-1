import { useMemo, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { slug } from "@/lib/api";
import { PageHeader, Select, SkeletonRows } from "@/components/Common";
import { TiltCard } from "@/components/TiltCard";

function TopCampaigns({ rows }) {
  const best = useMemo(() => {
    const map = {};
    rows.forEach((r) => { if (!map[r.treatment] || r.surgeries > map[r.treatment].surgeries || (r.surgeries === map[r.treatment].surgeries && r.conversion > map[r.treatment].conversion)) map[r.treatment] = r; });
    return Object.values(map).sort((a, b) => b.surgeries - a.surgeries);
  }, [rows]);
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      {best.slice(0, 4).map((r, i) => (
        <TiltCard key={r.treatment} delay={i * 0.05} className="kpi" data-testid={`best-campaign-${slug(r.treatment)}`}>
          <p className="eyebrow m-0">{r.treatment}</p>
          <p className="kpi-value">{r.variant}</p>
          <p className="text-xs font-semibold mt-2 mb-0" style={{ color: "var(--muted)" }}>{r.surgeries} surgeries · {r.conversion}% of {r.total} leads</p>
        </TiltCard>
      ))}
    </div>
  );
}

export default function Reports() {
  const { data, loading } = useApi("/reports/campaigns");
  const [treatment, setTreatment] = useState("");
  const rows = (data || []).filter((r) => !treatment || r.treatment === treatment);
  const treatments = [...new Set((data || []).map((r) => r.treatment))];
  const maxConv = Math.max(1, ...rows.map((r) => r.conversion));

  return (
    <div>
      <PageHeader eyebrow="Campaign conversion" title="Which campaigns bring surgeries" subtitle="Campaign codes (NW, BIDD, LL…) extracted by the treatment engine, ranked by surgeries done.">
        <Select testId="report-treatment-filter" value={treatment} onChange={setTreatment} options={treatments} placeholder="All treatments" className="w-auto" />
      </PageHeader>
      {loading && !data ? <SkeletonRows /> : (
        <>
          <TopCampaigns rows={data || []} />
          <div className="glass overflow-hidden">
            <div className="overflow-x-auto"><table className="table" data-testid="campaign-report-table"><thead><tr><th>Treatment</th><th>Campaign</th><th>Leads</th><th>Hot / OPD booked</th><th>OPD done</th><th>Surgeries</th><th>Lost</th><th className="w-1/5">Conversion</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={`${r.treatment}-${r.variant}`} data-testid={`campaign-row-${slug(r.treatment)}-${slug(r.variant)}`}>
                  <td><strong>{r.treatment}</strong></td><td><span className="tag">{r.variant}</span></td><td className="mono">{r.total}</td><td className="mono">{r.hot}</td><td className="mono">{r.opd}</td>
                  <td className="mono font-bold" style={{ color: r.surgeries ? "var(--ok)" : undefined }}>{r.surgeries}</td><td className="mono">{r.lost}</td>
                  <td><div className="flex items-center gap-2"><div className="bar flex-1"><i style={{ width: `${(r.conversion / maxConv) * 100}%` }} /></div><span className="mono text-xs w-12 text-right">{r.conversion}%</span></div></td>
                </tr>))}</tbody></table></div>
          </div>
        </>
      )}
    </div>
  );
}
