// [EN-TÊTE] App.jsx — routeur de l'application.
//   <Guard> protège une route : connecté ; adminOnly = rôle admin ; superAdminOnly = super administrateur ; module = accès au module.
//   Routes publiques : /login (connexion Microsoft, LoginSSO), /login/backup (mot de passe de secours, Login), /invite/:token (legacy).
//   Dans <Layout> : / (Portail), /dashboard /new /new/manual /transfer /history /mailbox-access /admin /security /offboarding
//   (module Onboarding), /monitoring et /monitoring/admin (module Monitoring), /portal-admin (super admin).
//   Ajouter un module : l'inscrire dans modules.js + ses routes ici + les routes serveur protégées par requireModule.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { UserProvider, useUser } from './context/UserContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import LoginSSO from './pages/LoginSSO';
import AcceptInvite from './pages/AcceptInvite';
import Dashboard from './pages/Dashboard';
import NewOnboarding from './pages/NewOnboarding';
import History from './pages/History';
import OnboardingDetail from './pages/OnboardingDetail';
import Admin from './pages/Admin';
import Security from './pages/Security';
import Offboarding from './pages/Offboarding';
import ManualOnboarding from './pages/ManualOnboarding';
import Transfer from './pages/Transfer';
import Portal from './pages/Portal';
import Monitoring from './pages/Monitoring';
import MonitoringAdmin from './pages/MonitoringAdmin';
import MailboxAccess from './pages/MailboxAccess';
import PortalAdmin from './pages/PortalAdmin';
import { canAccess } from './modules';

function Guard({ children, adminOnly = false, superAdminOnly = false, module = null }) {
  const { user, isSuperAdmin } = useUser();
  if (user === undefined) return <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  if (superAdminOnly && !isSuperAdmin) return <Navigate to="/" replace />;
  if (module && !canAccess(user, module)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useUser();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginSSO />} />
      <Route path="/login/backup" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/invite/:token" element={user ? <Navigate to="/" replace /> : <AcceptInvite />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Portal />} />
        <Route path="portal-admin" element={<Guard adminOnly superAdminOnly><PortalAdmin /></Guard>} />
        <Route path="dashboard" element={<Guard module="onboarding"><Dashboard /></Guard>} />
        <Route path="monitoring" element={<Guard module="monitoring"><Monitoring /></Guard>} />
        <Route path="monitoring/admin" element={<Guard adminOnly module="monitoring"><MonitoringAdmin /></Guard>} />
        <Route path="mailbox-access" element={<Guard adminOnly module="onboarding"><MailboxAccess /></Guard>} />
        <Route path="new" element={<Guard module="onboarding"><NewOnboarding /></Guard>} />
        <Route path="new/manual" element={<ManualOnboarding />} />
        <Route path="transfer" element={<Guard adminOnly module="onboarding"><Transfer /></Guard>} />
        <Route path="history" element={<Guard module="onboarding"><History /></Guard>} />
        <Route path="history/:id" element={<Guard module="onboarding"><OnboardingDetail /></Guard>} />
        <Route path="admin" element={<Guard adminOnly module="onboarding"><Admin /></Guard>} />
        <Route path="security" element={<Guard adminOnly module="onboarding"><Security /></Guard>} />
        <Route path="offboarding" element={<Guard adminOnly module="onboarding"><Offboarding /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <UserProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </UserProvider>
  );
}
