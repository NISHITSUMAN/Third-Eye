import { Navigate, Route, Routes } from 'react-router-dom';
import { SiteLayout } from './components/SiteLayout';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import Links from './pages/Links';
import Science from './pages/Science';
import Team from './pages/Team';

export default function App() {
  return (
    <SiteLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/science" element={<Navigate to="/learn" replace />} />
        <Route path="/learn" element={<Science />} />
        <Route path="/team" element={<Team />} />
        <Route path="/links" element={<Links />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/auth/callback" element={<Navigate to="/" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SiteLayout>
  );
}
