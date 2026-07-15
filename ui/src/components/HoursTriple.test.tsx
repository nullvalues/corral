import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperienceForm } from './ExperienceForm.js';
import { experienceFormSchema } from '../forms/experienceFormSchema.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Schema superRefine unit test
// ---------------------------------------------------------------------------

describe('experienceFormSchema superRefine', () => {
  it('rejects when totalHours !== hoursPerWeek * numberOfWeeks', () => {
    const result = experienceFormSchema.safeParse({
      categoryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      organization: 'Acme',
      position: 'Volunteer',
      startDate: '2023-01-01',
      totalHours: 10,
      hoursPerWeek: 3,
      numberOfWeeks: 3,
      dutiesNarrative: 'Some duties.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('totalHours = hoursPerWeek'))).toBe(true);
    }
  });

  it('accepts when totalHours === hoursPerWeek * numberOfWeeks', () => {
    const result = experienceFormSchema.safeParse({
      categoryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      organization: 'Acme',
      position: 'Volunteer',
      startDate: '2023-01-01',
      totalHours: 40,
      hoursPerWeek: 8,
      numberOfWeeks: 5,
      dutiesNarrative: 'Some duties.',
    });

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HoursTriple coupling tests (via ExperienceForm integration)
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const VALID_CATEGORY_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function renderForm(props: Partial<Parameters<typeof ExperienceForm>[0]> = {}) {
  vi.stubGlobal('fetch', vi.fn());
  const qc = makeQueryClient();
  const onSuccess = vi.fn();
  const onCancel = vi.fn();

  const result = render(
    <QueryClientProvider client={qc}>
      <ExperienceForm
        categoryId={VALID_CATEGORY_UUID}
        ownerUserId="user-1"
        onSuccess={onSuccess}
        onCancel={onCancel}
        {...props}
      />
    </QueryClientProvider>,
  );

  return { ...result, onSuccess, onCancel, qc };
}

/** Get all number inputs in the form. Order: [totalHours, hoursPerWeek, numberOfWeeks] */
function getNumberInputs() {
  return document.querySelectorAll<HTMLInputElement>('input[type="number"]');
}

describe('HoursTriple coupling', () => {
  it('auto-fills numberOfWeeks when totalHours=40 and hoursPerWeek=8 are set', async () => {
    renderForm();

    const inputs = getNumberInputs();
    const totalHoursInput = inputs[0];
    const hoursPerWeekInput = inputs[1];
    const numberOfWeeksInput = inputs[2];

    // Set totalHours = 40
    fireEvent.change(totalHoursInput, { target: { value: '40', valueAsNumber: 40 } });
    // Set hoursPerWeek = 8 (this is the second dirty field → derive numberOfWeeks = 40/8 = 5)
    fireEvent.change(hoursPerWeekInput, { target: { value: '8', valueAsNumber: 8 } });

    await waitFor(() => {
      expect(numberOfWeeksInput.value).toBe('5');
    });
  });

  it('shows inline error on numberOfWeeks when totalHours=10 and hoursPerWeek=3 (non-integer)', async () => {
    renderForm();

    const inputs = getNumberInputs();
    const totalHoursInput = inputs[0];
    const hoursPerWeekInput = inputs[1];

    fireEvent.change(totalHoursInput, { target: { value: '10', valueAsNumber: 10 } });
    fireEvent.change(hoursPerWeekInput, { target: { value: '3', valueAsNumber: 3 } });

    await waitFor(() => {
      expect(screen.getByText('Must produce a whole number of weeks')).toBeInTheDocument();
    });
  });

  it('submit is blocked when non-integer derivation sets an error', async () => {
    renderForm();

    const inputs = getNumberInputs();
    const totalHoursInput = inputs[0];
    const hoursPerWeekInput = inputs[1];

    // Fill required text fields so form validation passes for everything except hours
    fireEvent.change(screen.getByPlaceholderText('Organization name'), {
      target: { value: 'Acme Hospital' },
    });
    fireEvent.change(screen.getByPlaceholderText('Your role or title'), {
      target: { value: 'Volunteer' },
    });
    const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2023-01-15' } });

    fireEvent.change(totalHoursInput, { target: { value: '10', valueAsNumber: 10 } });
    fireEvent.change(hoursPerWeekInput, { target: { value: '3', valueAsNumber: 3 } });

    await waitFor(() => {
      expect(screen.getByText('Must produce a whole number of weeks')).toBeInTheDocument();
    });

    // Attempt submit — should not call fetch because the field has an error
    // (react-hook-form will also fail the superRefine since 10 !== 3*3)
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    fireEvent.click(screen.getByRole('button', { name: /add experience/i }));

    // fetch should NOT have been called since form validation blocks submission
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('auto-fills totalHours when hoursPerWeek=40 and numberOfWeeks=10 are set', async () => {
    renderForm();

    const inputs = getNumberInputs();
    const totalHoursInput = inputs[0];
    const hoursPerWeekInput = inputs[1];
    const numberOfWeeksInput = inputs[2];

    // Set hoursPerWeek = 40 first
    fireEvent.change(hoursPerWeekInput, { target: { value: '40', valueAsNumber: 40 } });
    // Set numberOfWeeks = 10 (this is the second dirty → derive totalHours = 40*10 = 400)
    fireEvent.change(numberOfWeeksInput, { target: { value: '10', valueAsNumber: 10 } });

    await waitFor(() => {
      expect(totalHoursInput.value).toBe('400');
    });
  });
});

describe('Momentum auto-derived treatment', () => {
  it('marks the derived field with data-auto and preserves the derived value', async () => {
    renderForm();
    const [total, perWeek, weeks] = getNumberInputs();

    fireEvent.change(total, { target: { value: '40', valueAsNumber: 40 } });
    fireEvent.change(perWeek, { target: { value: '8', valueAsNumber: 8 } });

    await waitFor(() => expect(weeks.value).toBe('5'));

    expect(weeks.getAttribute('data-auto')).toBe('true');
    expect(total.hasAttribute('data-auto')).toBe(false);
    expect(perWeek.hasAttribute('data-auto')).toBe(false);

    expect(screen.getByText('Enter any two — we calculate the third')).toBeInTheDocument();
  });
});
