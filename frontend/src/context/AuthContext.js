import { createContext, useContext, useEffect, useState } from "react";
import { clearSession, getSession, http, saveSession } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getSession()?.user ?? null);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    const onExpire = () => setUser(null);
    window.addEventListener("session-expired", onExpire);
    if (getSession()) {
      http.get("/auth/me").then((r) => { saveSession({ ...getSession(), user: r.data }); setUser(r.data); }).catch(() => setUser(getSession()?.user ?? null));
    }
    return () => window.removeEventListener("session-expired", onExpire);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const loadMeta = () => http.get("/meta").then((r) => setMeta(r.data)).catch(() => setMeta((m) => m));
    loadMeta();
    window.addEventListener("crm-synced", loadMeta);
    return () => window.removeEventListener("crm-synced", loadMeta);
  }, [user]);

  const login = async (email, password) => {
    const { data } = await http.post("/auth/login", { email, password });
    saveSession(data);
    setUser(data.user);
  };
  const logout = () => { clearSession(); setUser(null); setMeta(null); };
  const isAdmin = user && ["Master Owner", "Manager"].includes(user.role);

  return <AuthContext.Provider value={{ user, meta, login, logout, isAdmin }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
