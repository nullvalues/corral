import { createContext, useContext } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useMentorGrant } from '../hooks/useMentorGrant.js';
import { MentorBanner } from '../components/MentorBanner.js';
import { ShortlistControl } from '../components/ShortlistControl.js';

interface MentorGrantContext {
  grant: { permissions: string[]; applicantUserId: string; applicantName: string };
}

export const MentorContext = createContext<MentorGrantContext | null>(null);

export function useMentorContext() {
  return useContext(MentorContext);
}

export function MentorScopeLayout() {
  const { applicantUserId } = useParams<{ applicantUserId: string }>();
  const { grant, isLoading } = useMentorGrant(applicantUserId);
  if (isLoading) return <div>Loading…</div>;
  if (!grant) return <Navigate to="/experiences" replace />;
  return (
    <MentorContext.Provider value={{ grant }}>
      <MentorBanner />
      <ShortlistControl />
      <Outlet />
    </MentorContext.Provider>
  );
}
