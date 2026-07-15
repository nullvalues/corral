import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperienceDetailFlyout } from './ExperienceDetailFlyout.js';
import { MentorContext } from '../layouts/MentorScopeLayout.js';

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderFlyout(
  ui: React.ReactElement,
  opts: { mentor?: boolean; permissions?: string[] } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const permissions = opts.permissions ?? ['read', 'write'];
  const mentorValue = opts.mentor
    ? { grant: { permissions, applicantUserId: 'user-1', applicantName: 'App Licant' } }
    : null;
  return render(
    <QueryClientProvider client={qc}>
      <MentorContext.Provider value={mentorValue}>{ui}</MentorContext.Provider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeExperience(overrides: Partial<Record<string, unknown>> = {}): Parameters<typeof ExperienceDetailFlyout>[0]['experience'] {
  return {
    id: 'exp-1',
    ownerUserId: 'user-1',
    categoryId: 'cat-a',
    organization: 'Acme Corp',
    position: 'Researcher',
    frequency: null,
    startDate: '2023-01-01',
    endDate: null,
    dutiesNarrative: 'Did stuff',
    totalHours: 100,
    hoursPerWeek: 10,
    numberOfWeeks: 10,
    stateProvince: 'California',
    stateProvinceCode: 'CA',
    country: 'United States',
    countryIso2: 'US',
    countryIso3: 'USA',
    isCurrent: true,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: true,
    isVolunteer: false,
    isMostImportant: true,
    permissionToContact: true,
    contactTitle: 'Dr.',
    contactFirstName: 'Jane',
    contactLastName: 'Smith',
    contactEmail: 'jane@example.com',
    contactPhone: '+15551234567',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    verificationStatus: 'unverified',
    verifiedByUserId: null,
    verifiedAt: null,
    ...overrides,
  } as Parameters<typeof ExperienceDetailFlyout>[0]['experience'];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceDetailFlyout', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when experience is null', () => {
    const onClose = vi.fn();
    const { container } = renderFlyout(<ExperienceDetailFlyout experience={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders section labels and hours captions', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);
    expect(screen.getByText('DUTIES')).toBeInTheDocument();
    expect(screen.getByText('LOCATION')).toBeInTheDocument();
    expect(screen.getByText('ATTESTATIONS')).toBeInTheDocument();
    expect(screen.getByText('VERIFYING CONTACT')).toBeInTheDocument();
    expect(screen.getByText('total hrs')).toBeInTheDocument();
    expect(screen.getByText('hrs/week')).toBeInTheDocument();
    expect(screen.getByText('weeks')).toBeInTheDocument();
  });

  it('renders identity field values', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Researcher')).toBeInTheDocument();
    expect(screen.getByText('Did stuff')).toBeInTheDocument();
    expect(screen.getByText(/Ongoing/)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders location field values', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);

    expect(screen.getByText('California')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();
  });

  it('renders attestation chips', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);
    expect(screen.getByText('✓ Currently active')).toBeInTheDocument();
    expect(screen.getByText('✓ Paid')).toBeInTheDocument();
    expect(screen.getByText('No academic credit')).toBeInTheDocument();
    expect(screen.getByText('Not volunteer')).toBeInTheDocument();
  });

  it('renders contact fields', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText(/Dr\./)).toBeInTheDocument();
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders em dashes for null location fields', () => {
    const onClose = vi.fn();
    const experience = makeExperience({
      stateProvince: null,
      country: null,
    });
    renderFlyout(<ExperienceDetailFlyout experience={experience} onClose={onClose} />);

    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // UI-037 — verification badge + mentor verify/un-verify
  // -------------------------------------------------------------------------

  it('shows "Pending verification" badge for an unverified experience (all roles)', () => {
    const onClose = vi.fn();
    renderFlyout(
      <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'unverified' })} onClose={onClose} />,
    );
    expect(screen.getByTestId('verification-badge')).toHaveTextContent('Pending');
  });

  it('shows "✓ Verified" badge for a verified experience (all roles)', () => {
    const onClose = vi.fn();
    renderFlyout(
      <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'verified' })} onClose={onClose} />,
    );
    expect(screen.getByTestId('verification-badge')).toHaveTextContent('Verified');
  });

  it('hides the verify/un-verify button when no mentor context', () => {
    const onClose = vi.fn();
    renderFlyout(<ExperienceDetailFlyout experience={makeExperience()} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: /verify experience/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /un-verify experience/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('verification-badge')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // UI-047 — verify button gated on write permission
  // -------------------------------------------------------------------------

  it('hides verify/un-verify button for a read-only mentor grant (unverified)', () => {
    const onClose = vi.fn();
    renderFlyout(
      <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'unverified' })} onClose={onClose} />,
      { mentor: true, permissions: ['read'] },
    );
    expect(screen.queryByText('Verify experience')).toBeNull();
    expect(screen.queryByText('Un-verify experience')).toBeNull();
    expect(screen.getByTestId('verification-badge')).toBeInTheDocument();
  });

  it('hides verify/un-verify button for a read-only mentor grant (verified)', () => {
    const onClose = vi.fn();
    renderFlyout(
      <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'verified' })} onClose={onClose} />,
      { mentor: true, permissions: ['read'] },
    );
    expect(screen.queryByText('Verify experience')).toBeNull();
    expect(screen.queryByText('Un-verify experience')).toBeNull();
    expect(screen.getByTestId('verification-badge')).toBeInTheDocument();
  });

  describe('with active mentor context', () => {
    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows "Verify experience" for an unverified experience', () => {
      const onClose = vi.fn();
      renderFlyout(
        <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'unverified' })} onClose={onClose} />,
        { mentor: true },
      );
      expect(screen.getByRole('button', { name: /verify experience/i })).toBeInTheDocument();
    });

    it('shows "Un-verify experience" for a verified experience', () => {
      const onClose = vi.fn();
      renderFlyout(
        <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'verified' })} onClose={onClose} />,
        { mentor: true },
      );
      expect(screen.getByRole('button', { name: /un-verify experience/i })).toBeInTheDocument();
    });

    it('PATCHes with action verify on click', async () => {
      const onClose = vi.fn();
      renderFlyout(
        <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'unverified' })} onClose={onClose} />,
        { mentor: true },
      );
      fireEvent.click(screen.getByRole('button', { name: /verify experience/i }));
      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          '/api/experiences/exp-1/verification',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ action: 'verify' }),
          }),
        );
      });
    });

    it('PATCHes with action unverify on click', async () => {
      const onClose = vi.fn();
      renderFlyout(
        <ExperienceDetailFlyout experience={makeExperience({ verificationStatus: 'verified' })} onClose={onClose} />,
        { mentor: true },
      );
      fireEvent.click(screen.getByRole('button', { name: /un-verify experience/i }));
      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          '/api/experiences/exp-1/verification',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ action: 'unverify' }),
          }),
        );
      });
    });
  });
});
