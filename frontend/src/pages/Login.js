import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, Lock, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { errorText } from "@/lib/api";
import { Brand } from "@/components/Layout";

const floaters = [
  { icon: TrendingUp, title: "Hot pipeline", value: "+19 leads", style: { top: "22%", right: "12%" }, delay: 0 },
  { icon: CalendarClock, title: "Due today", value: "123 follow-ups", style: { top: "48%", right: "30%" }, delay: -2.3 },
  { icon: Sparkles, title: "Normalized", value: "bariatric (BIDD → Bariatric", style: { top: "70%", right: "8%" }, delay: -4.6 },
];

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try { await login(form.email, form.password); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="backdrop"><div className="blob blob-a" /><div className="blob blob-b" /><div className="blob blob-c" /></div>
      <section className="login-art">
        <Brand />
        {floaters.map(({ icon: Icon, title, value, style, delay }) => (
          <div key={title} className="float-card glass" style={{ ...style, animationDelay: `${delay}s` }}>
            <div className="flex items-center gap-3"><div className="kpi-icon" style={{ background: "linear-gradient(145deg,#3b82f6,#0f3fa8)", color: "#1e63e9" }}><Icon size={17} color="#fff" /></div>
              <div><p className="eyebrow m-0">{title}</p><p className="m-0 font-semibold text-sm" style={{ color: "var(--ink)" }}>{value}</p></div></div>
          </div>
        ))}
        <div className="max-w-xl relative z-10 mb-8">
          <p className="eyebrow mb-4" style={{ color: "var(--blue)" }}>BDM Command Center</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold m-0 leading-[1.02]">Every patient enquiry,<br /><span style={{ color: "var(--blue)" }}>moved forward.</span></h1>
          <p className="text-base mt-5 max-w-md" style={{ color: "var(--ink-2)" }}>Live leads from your master sheet, cleaned treatments, smart BDM allocation and a follow-up queue that never slips.</p>
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <motion.form onSubmit={submit} initial={{ opacity: 0, y: 20, rotateX: 8 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 0.6 }} className="glass w-full max-w-md p-8 sm:p-10 grid gap-5" data-testid="login-form">
          <div className="lg:hidden"><Brand /></div>
          <div><p className="eyebrow m-0 flex items-center gap-2"><Lock size={12} />Secure workspace</p><h2 className="text-3xl font-bold mt-2 mb-1">Welcome back</h2><p className="text-sm m-0" style={{ color: "var(--muted)" }}>Sign in to the Surgiassist CRM. Your role decides what you can see.</p></div>
          <label className="label">Email address<input data-testid="login-email-input" className="field" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@surgiassist.com" /></label>
          <label className="label">Password<input data-testid="login-password-input" className="field" type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Your password" /></label>
          {error && <div data-testid="login-error" className="text-sm rounded-xl px-3 py-2 tone-rose">{error}</div>}
          <button data-testid="login-submit-button" className="btn btn-primary h-12" type="submit" disabled={busy}>{busy ? "Signing in…" : "Enter workspace"}<ArrowRight size={16} /></button>
          <p className="text-xs m-0 flex items-center gap-2" style={{ color: "var(--muted)" }}><ShieldCheck size={14} />Role-based access for Owner, Manager and BDM accounts.</p>
        </motion.form>
      </section>
    </div>
  );
}
