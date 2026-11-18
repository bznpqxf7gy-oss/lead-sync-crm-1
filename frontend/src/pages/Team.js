import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { errorText, fmtDate, http, initials } from "@/lib/api";
import { PageHeader, Select, SkeletonRows } from "@/components/Common";

function AddUser({ open, setOpen, onDone }) {
  const { user, meta } = useAuth();
  const roles = user.role === "Master Owner" ? ["Master Owner", "Manager", "BDM"] : ["BDM"];
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "BDM", bdm_name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await http.post("/users", form); toast.success(`${form.name} can now sign in`); setForm({ name: "", email: "", password: "", role: "BDM", bdm_name: "", phone: "" }); setOpen(false); onDone(); } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="rounded-2xl" data-testid="add-user-dialog">
        <DialogHeader><DialogTitle className="display">Add team member</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <label className="label">Full name<input data-testid="new-user-name" className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="label">Email<input data-testid="new-user-email" type="email" className="field" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="label">Temporary password (min 8)<input data-testid="new-user-password" type="password" minLength={8} className="field" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label className="label">Role<Select testId="new-user-role" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={roles} /></label>
          {form.role === "BDM" && <label className="label">BDM name in sheet<input data-testid="new-user-bdm-name" list="bdm-names" className="field" value={form.bdm_name} onChange={(e) => setForm({ ...form, bdm_name: e.target.value })} placeholder="e.g. Pravin" /><datalist id="bdm-names">{(meta?.bdms || []).map((b) => <option key={b} value={b} />)}</datalist></label>}
          <label className="label">WhatsApp number (with country code)<input data-testid="new-user-phone" className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="919876543210" /></label>
          <button data-testid="new-user-submit" className="btn btn-primary mt-2" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Team() {
  const { user } = useAuth();
  const { data, loading, reload } = useApi("/users");
  const [open, setOpen] = useState(false);
  const patch = async (u, body) => { try { await http.patch(`/users/${u.id}`, body); toast.success(`${u.name} updated`); reload(); } catch (e) { toast.error(errorText(e)); } };
  const remove = async (u) => { if (!window.confirm(`Delete ${u.name}'s account?`)) return; try { await http.delete(`/users/${u.id}`); toast.success("Account deleted"); reload(); } catch (e) { toast.error(errorText(e)); } };

  return (
    <div>
      <PageHeader eyebrow="Role-based access" title="Team & Access" subtitle="Master Owners manage everyone. Managers can add BDMs. BDMs only see their own leads.">
        <button data-testid="add-user-button" className="btn btn-primary" onClick={() => setOpen(true)}><UserPlus size={15} />Add member</button>
      </PageHeader>
      <div className="glass overflow-hidden">
        {loading && !data ? <SkeletonRows /> : (
          <div className="overflow-x-auto"><table className="table" data-testid="users-table"><thead><tr><th>Member</th><th>Role</th><th>Sheet BDM</th><th>WhatsApp</th><th>Since</th><th>Active</th><th /></tr></thead>
            <tbody>{data?.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.email}`}>
                <td><div className="flex items-center gap-3"><div className="avatar">{initials(u.name)}</div><div><strong className="block">{u.name}</strong><span className="text-xs" style={{ color: "var(--muted)" }}>{u.email}</span></div></div></td>
                <td><span className="pill tone-blue">{u.role}</span></td><td>{u.bdm_name || "—"}</td><td><input data-testid={`user-phone-${u.email}`} className="field mono text-xs" style={{ height: 32, width: 140 }} defaultValue={u.phone || ""} placeholder="Add number" onBlur={(e) => e.target.value !== (u.phone || "") && patch(u, { phone: e.target.value })} /></td><td className="mono text-xs">{fmtDate(u.created_at)}</td>
                <td><Switch data-testid={`user-active-${u.email}`} checked={u.active !== false} disabled={u.id === user.id} onCheckedChange={(v) => patch(u, { active: v })} /></td>
                <td>{user.role === "Master Owner" && u.id !== user.id && <button data-testid={`user-delete-${u.email}`} className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => remove(u)} aria-label="Delete user"><Trash2 size={14} /></button>}</td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      <AddUser open={open} setOpen={setOpen} onDone={reload} />
    </div>
  );
}
