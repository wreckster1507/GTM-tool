import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
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

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/pipeline" replace />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/:id" element={<CompanyDetail />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="contacts/:id" element={<ContactDetail />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="meetings/:id" element={<MeetingDetail />} />
          <Route path="battlecards" element={<Battlecards />} />
          <Route path="deals/:id" element={<DealDetail />} />
          <Route path="dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
