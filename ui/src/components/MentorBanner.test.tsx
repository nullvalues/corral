import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { MentorContext } from '../layouts/MentorScopeLayout.js';
import { MentorBanner } from './MentorBanner.js';

// ---------------------------------------------------------------------------
// Mock useNavigate so we can assert navigation calls without a full router
// ---------------------------------------------------------------------------
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_GRANT = {
  applicantName: 'Alice',
  applicantUserId: 'u1',
  permissions: [] as string[],
};

function renderBanner(grant = BASE_GRANT) {
  return render(
    <MemoryRouter>
      <MentorContext.Provider value={{ grant }}>
        <MentorBanner />
      </MentorContext.Provider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('MentorBanner', () => {
  it('renders applicant name from context', () => {
    renderBanner();
    expect(screen.getByText('Viewing on behalf of Alice')).toBeInTheDocument();
  });

  it('"Exit mentor mode" button navigates to /experiences when clicked', () => {
    renderBanner();

    const button = screen.getByRole('button', { name: /exit mentor mode/i });
    fireEvent.click(button);

    expect(navigateMock).toHaveBeenCalledWith('/experiences');
  });

  it('renders null when context is null', () => {
    const { container } = render(
      <MemoryRouter>
        <MentorContext.Provider value={null}>
          <MentorBanner />
        </MentorContext.Provider>
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });
});
