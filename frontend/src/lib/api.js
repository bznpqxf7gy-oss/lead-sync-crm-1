import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const SESSION_KEY = "surgiassist-session";

export const getSession = () => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
};
export const saveSession = (session) => localStorage.setItem(SESSION_KEY, JSON.stringify(session));
export const clearSession = () => localStorage.removeItem(SESSION_KEY);

export const http = axios.create({ baseURL: API });
http.interceptors.request.use((config) => {
  const session = getSession();
  if (session?.token) config.headers.Authorization = `Bearer ${session.token}`;
  return config;
});
http.interceptors.response.use((r) => r, (error) => {
  if (error.response?.status === 401 && getSession()) {
    clearSession();
    window.dispatchEvent(new Event("session-expired"));
  }
  return Promise.reject(error);
});

export function errorText(error) {
  const detail = error?.response?.data?.detail;
  if (!detail) return error?.message || "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg || JSON.stringify(d)).join(" ");
  return detail.msg || String(detail);
}

export const STAGE_TONE = { "New": "blue", "Follow Up": "sky", "Not Reachable": "slate", "Hot Lead": "amber", "OPD Booked": "indigo", "OPD Done": "teal", "Surgery Done": "green", "Lost": "rose" };

export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
export const initials = (name = "") => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "SA";
export const slug = (s = "") => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
