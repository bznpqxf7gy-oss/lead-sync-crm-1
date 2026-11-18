import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { errorText, fmtDateTime, http } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export function SyncCountdown() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const last = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await http.get("/sync/status");
      if (last.current && data.last_synced_at !== last.current) window.dispatchEvent(new Event("crm-synced"));
      last.current = data.last_synced_at;
      setStatus(data);
    } catch (e) {
      console.warn("sync status", errorText(e));
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const poll = setInterval(fetchStatus, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [fetchStatus]);

  const syncNow = async () => {
    setBusy(true);
    try {
      const { data } = await http.post("/sync");
      toast.success(`Master sheet synced · ${data.count} leads`);
      await fetchStatus();
      window.dispatchEvent(new Event("crm-synced"));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const total = status?.interval_seconds || 300;
  const remaining = status?.next_sync_at ? Math.max(0, Math.round((new Date(status.next_sync_at) - now) / 1000)) : total;
  const progress = 1 - remaining / total;
  const label = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const healthy = status?.status !== "error";

  return (
    <div className="sync-pill" data-testid="sync-indicator" title={status?.last_synced_at ? `Last synced ${fmtDateTime(status.last_synced_at)}` : "Waiting for first sync"}>
      <div className="sync-ring">
        <svg width="30" height="30"><circle cx="15" cy="15" r="12" fill="none" stroke="rgba(30,99,233,.12)" strokeWidth="3" /><circle cx="15" cy="15" r="12" fill="none" stroke={healthy ? "#1e63e9" : "#d9455f"} strokeWidth="3" strokeLinecap="round" strokeDasharray={75.4} strokeDashoffset={75.4 * (1 - progress)} style={{ transition: "stroke-dashoffset 1s linear" }} /></svg>
        <span className="live-dot absolute" style={{ left: 11.5, top: 11.5, background: healthy ? undefined : "var(--bad)" }} />
      </div>
      <div className="leading-tight">
        <p className="sync-label eyebrow m-0" style={{ fontSize: 9 }}>{healthy ? "Live sheet sync" : "Sync issue"}</p>
        <p className="mono m-0 text-[13px] font-medium" data-testid="sync-countdown">{status?.running ? "syncing…" : label}</p>
      </div>
      {isAdmin && (
        <button data-testid="sync-now-button" onClick={syncNow} disabled={busy} className="icon-btn" style={{ width: 30, height: 30, borderRadius: 99 }} aria-label="Sync now">
          <RefreshCw size={14} className={busy ? "spin" : ""} />
        </button>
      )}
    </div>
  );
}
