import { useNavigate } from 'react-router-dom';
import { useMe } from '../hooks/useMe.js';
import { useMyMentorGrants } from '../hooks/useMyMentorGrants.js';

export function ApplicantPicker() {
  const { data: me } = useMe();
  const { data: grants } = useMyMentorGrants();
  const navigate = useNavigate();

  if (!me?.hasMentorGrants) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      View as applicant
      <select
        className="rounded-lg border border-hairline bg-card px-2 py-1 text-sm text-ink"
        onChange={(e) => {
          if (e.target.value) navigate(`/mentor/${encodeURIComponent(e.target.value)}/experiences`);
        }}
        defaultValue=""
      >
        <option value="" disabled>View as applicant…</option>
        {grants?.map((g) => (
          <option key={g.applicantUserId} value={g.applicantUserId}>
            {g.applicantName}
          </option>
        ))}
      </select>
    </label>
  );
}
