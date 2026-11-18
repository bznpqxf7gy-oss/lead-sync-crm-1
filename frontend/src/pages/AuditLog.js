import { useApi } from "@/hooks/useApi";
import { fmtDateTime } from "@/lib/api";
import { Empty, PageHeader, SkeletonRows } from "@/components/Common";

const summary = (d = {}) => Object.entries(d).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");

export default function AuditLog() {
  const { data, loading } = useApi("/audit", { limit: 300 });
  return (
    <div>
      <PageHeader eyebrow="Compliance" title="Audit Log" subtitle="Every sign-in, lead change, export, rule edit and account change — who did it and when." />
      <div className="glass overflow-hidden">
        {loading && !data ? <SkeletonRows /> : !data?.length ? <Empty title="No activity yet" /> : (
          <div className="overflow-x-auto"><table className="table" data-testid="audit-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}><td className="mono text-xs whitespace-nowrap">{fmtDateTime(a.created_at)}</td><td><strong className="block">{a.user_name}</strong><span className="text-xs" style={{ color: "var(--muted)" }}>{a.role}</span></td>
                <td><span className="tag">{a.action}</span></td><td className="mono text-xs">{a.target}</td><td className="text-xs max-w-sm truncate">{summary(a.details)}</td></tr>))}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
