import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, CalendarClock, Cross, FileClock, LayoutDashboard, LogOut, Menu, MessageCircle, Shuffle, Sparkles, Users, UsersRound } from "lucide-react";
import { ProfileDialog } from "@/components/ProfileDialog";
import { useAuth } from "@/context/AuthContext";
import { initials } from "@/lib/api";
import { SyncCountdown } from "@/components/SyncCountdown";
import { NotificationsBell } from "@/components/NotificationsBell";

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/leads", label: "Leads & Pipeline", icon: Users },
  { to: "/followups", label: "Follow-ups", icon: CalendarClock },
  { to: "/allocation", label: "BDM Allocation", icon: Shuffle, admin: true },
  { to: "/reports", label: "Campaign Report", icon: BarChart3, admin: true },
  { to: "/whatsapp", label: "WhatsApp Digest", icon: MessageCircle, admin: true },
  { to: "/normalization", label: "Treatment Engine", icon: Sparkles, admin: true },
  { to: "/team", label: "Team & Access", icon: UsersRound, admin: true },
  { to: "/audit", label: "Audit Log", icon: FileClock, admin: true },
];

export const Brand = () => (
  <div className="brand"><div className="brand-badge"><Cross size={18} strokeWidth={2.6} /></div><div className="brand-name">Surgi<span>assist</span></div></div>
);

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const { pathname } = useLocation();
  const items = NAV.filter((n) => !n.admin || isAdmin);
  const current = items.find((n) => pathname.startsWith(n.to))?.label || "Overview";

  return (
    <div className="shell">
      <div className="backdrop"><div className="blob blob-a" /><div className="blob blob-b" /><div className="blob blob-c" /></div>
      <div className={`scrim ${open ? "open" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar glass ${open ? "open" : ""}`} data-testid="sidebar">
        <Brand />
        <p className="eyebrow px-3 mb-2">Workspace</p>
        <nav className="grid gap-1">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setOpen(false)} data-testid={`nav-${to.slice(1)}`} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Icon size={17} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-center gap-3 px-1">
            <button data-testid="profile-button" onClick={() => setProfile(true)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label="Profile and password">
            <div className="avatar">{initials(user.name)}</div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold m-0 truncate" data-testid="current-user-name">{user.name}</p><p className="text-xs m-0" style={{ color: "var(--muted)" }} data-testid="current-user-role">{user.role} · Profile</p></div>
            </button>
            <button data-testid="logout-button" onClick={logout} className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Log out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar glass">
          <div className="flex items-center gap-3 min-w-0">
            <button data-testid="mobile-menu-button" className="icon-btn mobile-toggle" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={17} /></button>
            <div className="min-w-0"><p className="eyebrow m-0 hidden sm:block">Surgiassist / {current}</p><h1 className="page-title truncate" data-testid="page-title">{current}</h1></div>
          </div>
          <div className="flex items-center gap-2"><SyncCountdown /><NotificationsBell /></div>
        </header>
        <motion.div key={pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <Outlet />
        </motion.div>
      </main>
      <ProfileDialog open={profile} setOpen={setProfile} />
    </div>
  );
}
