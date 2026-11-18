import { useEffect, useState } from "react";
import { ArrowRight, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/useApi";
import { errorText, http } from "@/lib/api";
import { PageHeader, SkeletonRows } from "@/components/Common";

function Tester() {
  const [text, setText] = useState("bariatric surgery (BIDD");
  const [result, setResult] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => http.post("/normalization/preview", { text }).then((r) => setResult(r.data)).catch(() => setResult(null)), 250);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="glass panel mb-4">
      <p className="eyebrow m-0 flex items-center gap-2"><Wand2 size={12} />Live tester</p>
      <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-center mt-3">
        <input data-testid="normalization-test-input" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type any messy treatment string" />
        <ArrowRight className="hidden md:block" color="#1e63e9" />
        <div className="flex items-center gap-2 h-10"><strong className="display text-lg" data-testid="normalization-test-result">{result?.treatment || "—"}</strong>{result?.variant && <span className="tag">{result.variant}</span>}</div>
      </div>
    </div>
  );
}

function RulesEditor({ rules, setRules, onSave, busy }) {
  const update = (i, patch) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="glass panel">
      <div className="flex items-center justify-between mb-4"><div><p className="eyebrow m-0">Keyword rules · first match wins</p><h3 className="panel-title">Canonical categories</h3></div>
        <button data-testid="add-rule-button" className="btn btn-ghost btn-sm" onClick={() => setRules([...rules, { category: "", keywords: "" }])}><Plus size={14} />Add</button></div>
      <div className="grid gap-3">
        {rules.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 p-3 rounded-xl" style={{ background: "rgba(255,255,255,.6)", border: "1px solid var(--line)" }} data-testid={`rule-row-${i}`}>
            <input data-testid={`rule-category-${i}`} className="field" value={r.category} onChange={(e) => update(i, { category: e.target.value })} placeholder="Category name" />
            <button data-testid={`rule-delete-${i}`} className="icon-btn" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Delete rule"><Trash2 size={15} /></button>
            <input data-testid={`rule-keywords-${i}`} className="field col-span-2 mono text-xs" value={r.keywords} onChange={(e) => update(i, { keywords: e.target.value })} placeholder="keywords, comma, separated" />
          </div>
        ))}
      </div>
      <button data-testid="save-rules-button" className="btn btn-primary w-full mt-4" onClick={onSave} disabled={busy}><Save size={15} />{busy ? "Re-normalizing…" : "Save & re-normalize all leads"}</button>
    </div>
  );
}

export default function Normalization() {
  const { data, loading, reload } = useApi("/normalization");
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRules(data.rules.map((r) => ({ category: r.category, keywords: r.keywords.join(", ") }))); }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { rules: rules.filter((r) => r.category.trim()).map((r) => ({ category: r.category, keywords: r.keywords.split(",") })) };
      const { data: res } = await http.put("/normalization", body);
      toast.success(`Rules saved · ${res.leads_updated} leads re-categorized`);
      reload();
      window.dispatchEvent(new Event("crm-synced"));
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Treatment normalization engine" title="Clean treatment data" subtitle="Messy sheet values like 'bariatric surgery (BIDD' or 'VARICOSE A/B – Copy' are mapped to one canonical treatment, with the campaign code kept as a tag." />
      <Tester />
      {loading && !data ? <SkeletonRows /> : (
        <div className="grid xl:grid-cols-[420px_1fr] gap-4 items-start">
          <RulesEditor rules={rules} setRules={setRules} onSave={save} busy={busy} />
          <div className="glass overflow-hidden">
            <div className="panel pb-2"><p className="eyebrow m-0">{data.mappings.length} distinct raw values</p><h3 className="panel-title">Raw → canonical mapping</h3></div>
            <div className="overflow-x-auto"><table className="table" data-testid="normalization-mapping-table"><thead><tr><th>Raw sheet value</th><th>Canonical</th><th>Variant</th><th>Leads</th></tr></thead>
              <tbody>{data.mappings.map((m) => <tr key={m.raw}><td className="mono text-xs">{m.raw}</td><td><strong>{m.treatment}</strong></td><td>{m.variant ? <span className="tag">{m.variant}</span> : "—"}</td><td className="mono">{m.count}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      )}
    </div>
  );
}
