import { useNavigate } from 'react-router-dom';
import { useMentorContext } from '../layouts/MentorScopeLayout.js';

export function MentorBanner() {
  const ctx = useMentorContext();
  const navigate = useNavigate();
  if (!ctx) return null;
  return (
    <div className="sticky top-0 z-50 w-full bg-ink text-text-inverted flex items-center justify-between px-4 py-2">
      <span>Viewing on behalf of {ctx.grant.applicantName}</span>
      <button
        type="button"
        onClick={() => navigate('/experiences')}
        className="ml-4 font-medium text-primary-400 underline"
      >
        Exit mentor mode
      </button>
    </div>
  );
}
