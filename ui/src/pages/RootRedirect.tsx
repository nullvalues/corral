import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserRoles } from '../hooks/useUserRoles.js';

export function RootRedirect() {
  const { isAdmin, isReady } = useUserRoles();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isReady) return;
    if (isAdmin) {
      void navigate('/admin', { replace: true });
    } else {
      void navigate('/home', { replace: true });
    }
  }, [isReady, isAdmin, navigate]);

  if (!isReady) return <p role="status">Loading…</p>;

  return null;
}
