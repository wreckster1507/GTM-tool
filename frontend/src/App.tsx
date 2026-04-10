import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import Layout from "./components/layout/Layout";
import AircallPhonePanel from "./components/AircallPhone";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Pipeline from "./pages/Pipeline";
import ImportPage from "./pages/Import";
import Companies from "./pages/Companies";
import CompanyDetail from "./pages/CompanyDetail";
import Contacts from "./pages/Contacts";
import ContactDetail from "./pages/ContactDetail";
import DealDetail from "./pages/DealDetail";
import Dashboard from "./pages/Dashboard";
import Meetings from "./pages/Meetings";
import MeetingDetail from "./pages/MeetingDetail";
import Battlecards from "./pages/Battlecards";
import SalesWorkspace from "./pages/SalesWorkspace";
import SalesAnalytics from "./pages/SalesAnalytics";
import PreMeetingPlaceholder from "./pages/PreMeetingPlaceholder";
import CustomDemoAssistance from "./pages/CustomDemoAssistance";
import AccountSourcing from "./pages/AccountSourcing";
import AccountSourcingCompanyDetail from "./pages/AccountSourcingCompanyDetail";
import AccountSourcingContactDetail from "./pages/AccountSourcingContactDetail";
import KnowledgeBase from "./pages/KnowledgeBase";
import TeamManagement from "./pages/TeamManagement";
import ExecutionTracker from "./pages/ExecutionTracker";
import SettingsPage from "./pages/Settings";
import TasksPage from "./pages/Tasks";

// Scroll to top on forward navigation; let browser handle back/forward scroll restoration
function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType === "PUSH") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [pathname, navType]);
  return null;
}

function RouteScopedAircallPhone() {
  return <AircallPhonePanel />;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ScrollToTop />
        {/* Aircall phone widget — only on prospecting/contact routes */}
        <RouteScopedAircallPhone />
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/pipeline" replace />} />
            <Route path="sales-workspace" element={<SalesWorkspace />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="companies" element={<Companies />} />
            <Route path="account-sourcing" element={<AccountSourcing />} />
            <Route path="account-sourcing/:id" element={<AccountSourcingCompanyDetail />} />
            <Route path="account-sourcing/contacts/:id" element={<AccountSourcingContactDetail />} />
            <Route path="companies/:id" element={<CompanyDetail />} />
            <Route path="contacts" element={<Contacts />} />
            {/* A few legacy nav links still point at older route names.
                Keep them as aliases so bookmarks and sidebar labels continue to work. */}
            <Route path="prospecting" element={<Contacts />} />
            <Route path="contacts/:id" element={<ContactDetail />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="pre-meeting-assistance" element={<PreMeetingPlaceholder />} />
            <Route path="custom-demo-assistance" element={<CustomDemoAssistance />} />
            <Route path="meetings/:id" element={<MeetingDetail />} />
            <Route path="battlecards" element={<Battlecards />} />
            <Route path="live-meeting-assistance" element={<Battlecards />} />
            <Route path="deals/:id" element={<DealDetail />} />
            <Route path="sales-analytics" element={<SalesAnalytics />} />
            <Route path="dashboard" element={<SalesAnalytics />} />
            <Route path="crm-insights-alerts" element={<SalesAnalytics />} />
            <Route path="workspace-insights" element={<Dashboard />} />
            <Route path="knowledge-base" element={<KnowledgeBase />} />
            <Route path="angel-mapping" element={<Contacts />} />
            <Route path="execution-tracker" element={<ExecutionTracker />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="team" element={<TeamManagement />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
