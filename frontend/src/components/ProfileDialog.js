import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { errorText, http } from "@/lib/api";

export function ProfileDialog({ open, setOpen }) {
  const { user } = useAuth();
  const blank = { current_password: "", new_password: "", confirm: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) { toast.error("New passwords don't match"); return; }
    setBusy(true);
    try {
      await http.post("/auth/change-password", { current_password: form.current_password, new_password: form.new_password });
      toast.success("Password changed");
      setForm(blank);
      setOpen(false);
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
  };
  const field = (key, label) => (
    <label className="label">{label}<input data-testid={`profile-${key.replace("_", "-")}-input`} type="password" minLength={key === "current_password" ? undefined : 8} required className="field" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="rounded-2xl" data-testid="profile-dialog">
        <DialogHeader><DialogTitle className="display">{user.name}</DialogTitle><p className="text-sm m-0" style={{ color: "var(--muted)" }}>{user.email} · {user.role}</p></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <p className="eyebrow m-0 flex items-center gap-2"><KeyRound size={12} />Change password</p>
          {field("current_password", "Current password")}
          {field("new_password", "New password (min 8)")}
          {field("confirm", "Confirm new password")}
          <button data-testid="profile-save-password" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
