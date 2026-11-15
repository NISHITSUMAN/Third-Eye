import { Navigate, Route, Routes } from 'react-router-dom';
import { SiteLayout } from './components/SiteLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import Links from './pages/Links';
import Login from './pages/Login';
import Science from './pages/Science';
import Team from './pages/Team';

export default function App() {
  return (
    <SiteLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/science" element={<Navigate to="/learn" replace />} />
        <Route path="/learn" element={<ProtectedRoute><Science /></ProtectedRoute>} />
        <Route path="/team" element={<Team />} />
        <Route path="/links" element={<Links />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SiteLayout>
  );
}
