import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMyApplicantGrants } from '../hooks/useMyApplicantGrants.js';
import { useMe } from '../hooks/useMe.js';
import { RequestMentorModal } from '../components/RequestMentorModal.js';

function mentorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
  return (name[0] ?? '?').toUpperCase();
}

export function MentorStatusPage() {
  const { data: me } = useMe();
  const { data: myGrants, isLoading: grantsLoading } = useMyApplicantGrants();
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  const isAdmin = me?.roles?.includes('admin') ?? false;

  // Find most-relevant grant (active > pending > none)
  const grantsArray = Array.isArray(myGrants) ? myGrants : [];
  const activeGrant = grantsArray.find((g) => g.status === 'active');
  const pendingGrant = grantsArray.find((g) => g.status === 'pending');
  const currentGrant = activeGrant ?? pendingGrant ?? null;

  // Admins have no applicant mentor status — render an empty shell.
  if (isAdmin) {
    return <main className="px-[18px] py-4" />;
  }

  // Until the grants query resolves, do not flash the empty state.
  if (grantsLoading) {
    return (
      <main className="px-[18px] py-4">
        <h1 className="mb-4 font-display text-xl font-bold text-ink">Mentor</h1>
      </main>
    );
  }

  return (
    <main className="px-[18px] py-4">
      <h1 className="mb-4 font-display text-xl font-bold text-ink">Mentor</h1>

      {currentGrant === null && (
        <div className="flex flex-col items-start gap-3">
          <span className="text-sm text-text-muted">No mentor assigned</span>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-primary-500 px-3 py-1.5 text-sm text-white hover:bg-primary-600"
          >
            Request a mentor
          </button>
        </div>
      )}

      {currentGrant?.status === 'pending' && (
        <p className="text-sm text-text-muted">
          Mentor request pending — awaiting admin approval
          {currentGrant.mentorEmail ? (
            <span className="ml-1 font-medium text-text-default">({currentGrant.mentorEmail})</span>
          ) : null}
        </p>
      )}

      {currentGrant?.status === 'active' && (
        <div className="flex flex-col gap-4">
          {/* Mentor card */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink font-display text-base font-bold text-white">
              {mentorInitials(currentGrant.mentorName)}
            </div>
            <div>
              <p className="font-semibold text-ink">
                {currentGrant.mentorName || currentGrant.mentorEmail}
              </p>
              {currentGrant.mentorName && (
                <p className="text-sm text-text-muted">{currentGrant.mentorEmail}</p>
              )}
              <p className="text-xs text-text-muted">
                Connected since{' '}
                {new Date(currentGrant.grantedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={() => navigate('/experiences')}
            className="self-start rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
          >
            Your experiences →
          </button>
        </div>
      )}

      {showModal && <RequestMentorModal onClose={() => setShowModal(false)} />}
    </main>
  );
}
