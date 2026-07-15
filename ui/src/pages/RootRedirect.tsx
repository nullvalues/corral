import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../hooks/useMe.js';

export function RootRedirect() {
  const { data, isLoading } = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (!data) return;
    if (data.roles.includes('admin')) {
      void navigate('/admin', { replace: true });
    } else {
      void navigate('/home', { replace: true });
    }
  }, [data, navigate]);

  if (isLoading || !data) return <p role="status">Loading…</p>;

  return null;
}
