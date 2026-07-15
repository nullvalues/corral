import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DutiesEditor } from './DutiesEditor.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperienceForm } from './ExperienceForm.js';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// DutiesEditor unit tests
// ---------------------------------------------------------------------------

describe('DutiesEditor', () => {
  it('shows live character count for a 100-char value', () => {
    const value = 'a'.repeat(100);
    render(<DutiesEditor value={value} onChange={vi.fn()} />);
    expect(screen.getByText('100 / 8192')).toBeInTheDocument();
  });

  it('shows no error message for exactly 8192 characters', () => {
    const value = 'a'.repeat(8192);
    render(<DutiesEditor value={value} onChange={vi.fn()} />);
    expect(screen.getByText('8192 / 8192')).toBeInTheDocument();
    expect(
      screen.queryByText('Duties must be 8192 characters or fewer'),
    ).not.toBeInTheDocument();
  });

  it('shows error message when value exceeds 8192 characters', () => {
    const value = 'a'.repeat(8193);
    render(<DutiesEditor value={value} onChange={vi.fn()} />);
    expect(screen.getByText('8193 / 8192')).toBeInTheDocument();
    expect(
      screen.getByText('Duties must be 8192 characters or fewer'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExperienceForm submit-guard integration tests
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

describe('ExperienceForm submit button guard for duties', () => {
  it('submit button is enabled when duties is exactly 8192 chars', () => {
    vi.stubGlobal('fetch', vi.fn());
    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ExperienceForm
          categoryId={VALID_CATEGORY_UUID}
          ownerUserId="user-1"
          onSuccess={vi.fn()}
          onCancel={vi.fn()}
          defaultValues={{ dutiesNarrative: 'a'.repeat(8192) }}
        />
      </QueryClientProvider>,
    );

    const submitBtn = screen.getByRole('button', { name: /add experience/i });
    expect(submitBtn).not.toBeDisabled();
    vi.restoreAllMocks();
  });

  it('submit button is disabled when duties exceeds 8192 chars', () => {
    vi.stubGlobal('fetch', vi.fn());
    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ExperienceForm
          categoryId={VALID_CATEGORY_UUID}
          ownerUserId="user-1"
          onSuccess={vi.fn()}
          onCancel={vi.fn()}
          defaultValues={{ dutiesNarrative: 'a'.repeat(8193) }}
        />
      </QueryClientProvider>,
    );

    const submitBtn = screen.getByRole('button', { name: /add experience/i });
    expect(submitBtn).toBeDisabled();
    vi.restoreAllMocks();
  });
});
