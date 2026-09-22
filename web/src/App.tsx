import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import NotFoundPage from './app/NotFoundPage';
import HomePage from './features/home/HomePage';
import RunPage from './features/run/RunPage';

const LEGACY_HASH = /^#[\w-]+$/;

function LegacyHashRedirect() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (hash && LEGACY_HASH.test(hash) && !pathname.startsWith('/runs/')) {
      navigate(`/runs/${hash.slice(1)}`, { replace: true });
    }
  }, [hash, pathname, navigate]);

  return null;
}

export default function App() {
  return (
    <>
      <LegacyHashRedirect />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/runs/:id" element={<RunPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
