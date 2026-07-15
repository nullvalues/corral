/**
 * ExperienceForm — draft/autosave tests (UI-106)
 *
 * Tests:
 * 1. Typing a field then advancing 500ms writes the draft under the correct key (new variant).
 * 2. Typing a field then advancing 500ms writes the draft under the correct key (edit/existing variant).
 * 3. Mounting with an existing draft populates the form and shows the "Draft restored" toast.
 * 4. Successful save removes the draft key.
 * 5. Cancel removes the draft key.
 * 6. Corrupt draft JSON is silently discarded without error.
 */
import { cleanup, fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperienceForm } from './ExperienceForm.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock('../hooks/useCreateExperience.js', () => ({
  useCreateExperience: () => ({
    mutateAsync: createMutateAsync,
    isPending: false,
  }),
}));

vi.mock('../hooks/useUpdateExperience.js', () => ({
  useUpdateExperience: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
  }),
}));

// Stub useQuery so categories don't need a network
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const EXP_ID = 'exp-123';
const CAT_ID = '00000000-0000-0000-0000-000000000001';

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderForm(opts: {
  experienceId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const onSuccess = opts.onSuccess ?? vi.fn();
  const onCancel = opts.onCancel ?? vi.fn();
  const qc = makeQc();
  render(
    <QueryClientProvider client={qc}>
      <ExperienceForm
        categoryId={CAT_ID}
        ownerUserId={USER_ID}
        experienceId={opts.experienceId}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </QueryClientProvider>,
  );
  return { onSuccess, onCancel };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceForm — draft/autosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    createMutateAsync.mockReset();
    updateMutateAsync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('writes draft under asp:draft:<userId>:new after 500ms debounce (new experience)', () => {
    renderForm({});
    const orgInput = screen.getByPlaceholderText('Organization name');

    fireEvent.change(orgInput, { target: { value: 'My Org' } });

    // Before debounce fires — nothing written yet
    expect(localStorage.getItem(`asp:draft:${USER_ID}:new`)).toBeNull();

    // Advance fake timers past 500ms
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const raw = localStorage.getItem(`asp:draft:${USER_ID}:new`);
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw!);
    expect(payload.values.organization).toBe('My Org');
  });

  it('writes draft under asp:draft:<userId>:<experienceId> after 500ms debounce (edit experience)', () => {
    renderForm({ experienceId: EXP_ID });
    const orgInput = screen.getByPlaceholderText('Organization name');

    fireEvent.change(orgInput, { target: { value: 'Edit Org' } });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const raw = localStorage.getItem(`asp:draft:${USER_ID}:${EXP_ID}`);
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw!);
    expect(payload.values.organization).toBe('Edit Org');
  });

  it('populates form from an existing draft and shows "Draft restored" toast', () => {
    const draftKey = `asp:draft:${USER_ID}:new`;
    const draftPayload = {
      values: { organization: 'Saved Org', position: 'My Role' },
      step: 0,
    };
    localStorage.setItem(draftKey, JSON.stringify(draftPayload));

    renderForm({});

    // The toast should appear
    expect(screen.getByRole('status')).toHaveTextContent('Draft restored');

    // The form field should reflect the draft value
    const orgInput = screen.getByPlaceholderText('Organization name') as HTMLInputElement;
    expect(orgInput.value).toBe('Saved Org');
  });

  it('removes the draft key on successful save', async () => {
    // Switch to real timers for this test so async resolution works normally
    vi.useRealTimers();

    const draftKey = `asp:draft:${USER_ID}:new`;
    // Pre-populate draft with all required fields so the form restores them
    const draftValues = {
      organization: 'My Org',
      position: 'My Role',
      startDate: '2023-01-01',
      dutiesNarrative: 'I did things.',
      totalHours: 1,
      hoursPerWeek: 1,
      numberOfWeeks: 1,
    };
    localStorage.setItem(draftKey, JSON.stringify({ values: draftValues, step: 0 }));

    createMutateAsync.mockResolvedValueOnce({});

    const { onSuccess } = renderForm({});

    // The sticky header submit button is always visible
    const submitBtns = screen.getAllByText(/Add Experience/);
    await act(async () => {
      fireEvent.click(submitBtns[0]);
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('removes the draft key on cancel', () => {
    const draftKey = `asp:draft:${USER_ID}:new`;
    localStorage.setItem(draftKey, JSON.stringify({ values: { organization: 'Org' }, step: 0 }));

    const { onCancel } = renderForm({});

    fireEvent.click(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('silently discards corrupt draft JSON without crashing the form', () => {
    const draftKey = `asp:draft:${USER_ID}:new`;
    localStorage.setItem(draftKey, 'NOT VALID JSON {{{');

    // Should render without throwing
    expect(() => renderForm({})).not.toThrow();

    // The corrupt draft was removed
    expect(localStorage.getItem(draftKey)).toBeNull();

    // The form renders normally — organization input is present and empty
    const orgInput = screen.getByPlaceholderText('Organization name') as HTMLInputElement;
    expect(orgInput.value).toBe('');

    // No toast shown
    expect(screen.queryByRole('status')).toBeNull();
  });
});
