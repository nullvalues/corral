import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage.js';

function renderAdminPage() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

describe('AdminPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a Categories card linking to /admin/categories', () => {
    renderAdminPage();
    const link = screen.getByRole('link', { name: /^Categories/ });
    expect(link).toHaveAttribute('href', '/admin/categories');
  });

  it('renders a Grants card linking to /admin/grants', () => {
    renderAdminPage();
    const link = screen.getByRole('link', { name: /^Grants/ });
    expect(link).toHaveAttribute('href', '/admin/grants');
  });

  it('renders a Users card linking to /admin/users', () => {
    renderAdminPage();
    const link = screen.getByRole('link', { name: /^Users/ });
    expect(link).toHaveAttribute('href', '/admin/users');
  });

  it('renders a Readiness card linking to /admin/settings', () => {
    renderAdminPage();
    const link = screen.getByRole('link', { name: /^Readiness/ });
    expect(link).toHaveAttribute('href', '/admin/settings');
  });

  it('renders a Milestone awards card linking to /admin/milestone-awards', () => {
    renderAdminPage();
    const link = screen.getByRole('link', { name: /^Milestone awards/ });
    expect(link).toHaveAttribute('href', '/admin/milestone-awards');
  });

  it('renders a Flags card linking to /admin/flags', () => {
    renderAdminPage();
    const link = screen.getByRole('link', { name: /^Flags/ });
    expect(link).toHaveAttribute('href', '/admin/flags');
  });
});
