import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ApplicantPicker } from './ApplicantPicker.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ApplicantPicker', () => {
  it('renders null when hasMentorGrants is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url) === '/api/me') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
            roles: ['applicant'],
            hasMentorGrants: false,
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } as Response);
    });

    const { container } = renderWithProviders(<ApplicantPicker />);

    // Wait a tick for queries to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(container.firstChild).toBeNull();
  });

  it('renders select with applicant names when hasMentorGrants is true', async () => {
    const grants = [
      {
        id: 'g1',
        applicantUserId: 'u-app-1',
        applicantName: 'Bob Applicant',
        applicantEmail: 'bob@example.com',
        permissions: ['read'],
        status: 'active',
      },
      {
        id: 'g2',
        applicantUserId: 'u-app-2',
        applicantName: 'Carol Applicant',
        applicantEmail: 'carol@example.com',
        permissions: ['read'],
        status: 'active',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url) === '/api/me') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
            roles: ['applicant'],
            hasMentorGrants: true,
          }),
        } as Response);
      }
      if (String(url) === '/api/mentor-grants/mine') {
        return Promise.resolve({
          ok: true,
          json: async () => grants,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } as Response);
    });

    renderWithProviders(<ApplicantPicker />);

    // Wait for both queries to resolve
    await screen.findByText('Bob Applicant');
    expect(screen.getByText('Carol Applicant')).toBeInTheDocument();
    expect(screen.getByText('View as applicant…')).toBeInTheDocument();
  });

  it('select has accessible name "View as applicant"', async () => {
    const grants = [
      {
        id: 'g1',
        applicantUserId: 'u-app-1',
        applicantName: 'Bob Applicant',
        applicantEmail: 'bob@example.com',
        permissions: ['read'],
        status: 'active',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url) === '/api/me') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
            roles: ['applicant'],
            hasMentorGrants: true,
          }),
        } as Response);
      }
      if (String(url) === '/api/mentor-grants/mine') {
        return Promise.resolve({
          ok: true,
          json: async () => grants,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      } as Response);
    });

    renderWithProviders(<ApplicantPicker />);

    // Wait for the select to render
    const select = await screen.findByRole('combobox', { name: /view as applicant/i });
    expect(select).toBeInTheDocument();
  });
});
