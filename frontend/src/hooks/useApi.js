import { useCallback, useEffect, useState } from "react";
import { errorText, http } from "@/lib/api";

export function useApi(path, params) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const key = JSON.stringify(params || {});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get(path, { params: JSON.parse(key) });
      setData(res.data);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [path, key]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener("crm-synced", load);
    return () => window.removeEventListener("crm-synced", load);
  }, [load]);

  return { data, loading, error, reload: load, setData };
}
