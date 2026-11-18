import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Leads from "@/pages/Leads";
import Followups from "@/pages/Followups";
import Allocation from "@/pages/Allocation";
import Normalization from "@/pages/Normalization";
import Team from "@/pages/Team";
import AuditLog from "@/pages/AuditLog";
import Reports from "@/pages/Reports";
import WhatsApp from "@/pages/WhatsApp";

function Protected({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/overview" replace />;
}

function LoginRoute() {
  const { user } = useAuth();
  return user ? <Navigate to="/overview" replace /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route path="/overview" element={<Overview />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/followups" element={<Followups />} />
            <Route path="/allocation" element={<AdminOnly><Allocation /></AdminOnly>} />
            <Route path="/normalization" element={<AdminOnly><Normalization /></AdminOnly>} />
            <Route path="/team" element={<AdminOnly><Team /></AdminOnly>} />
            <Route path="/audit" element={<AdminOnly><AuditLog /></AdminOnly>} />
            <Route path="/reports" element={<AdminOnly><Reports /></AdminOnly>} />
            <Route path="/whatsapp" element={<AdminOnly><WhatsApp /></AdminOnly>} />
          </Route>
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}
