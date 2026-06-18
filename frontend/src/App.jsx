import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { UserProvider, useUser } from './context/UserContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import Dashboard from './pages/Dashboard';
import NewOnboarding from './pages/NewOnboarding';
import History from './pages/History';
import OnboardingDetail from './pages/OnboardingDetail';
import Admin from './pages/Admin';

function Guard({ children, adminOnly = false }) {
  const { user } = useUser();
  if (user === undefined) return <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useUser();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="new" element={<NewOnboarding />} />
        <Route path="history" element={<History />} />
        <Route path="history/:id" element={<OnboardingDetail />} />
        <Route path="admin" element={<Guard adminOnly><Admin /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <UserProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </UserProvider>
  );
}
