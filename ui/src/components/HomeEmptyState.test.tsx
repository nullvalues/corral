import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect } from 'vitest';
import { HomeEmptyState } from './HomeEmptyState.js';

afterEach(() => {
  cleanup();
});

const categories = [
  { id: '1', name: 'Animal/Veterinary Science', goalHours: 40 },
  { id: '2', name: 'Research', goalHours: null },
];

function renderComponent(props: Partial<React.ComponentProps<typeof HomeEmptyState>> = {}) {
  return render(
    <MemoryRouter>
      <HomeEmptyState
        name="Test User"
        categories={categories}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('HomeEmptyState — isAdmin=false (default)', () => {
  it('renders the hero card headline', () => {
    renderComponent();
    expect(screen.getByText(/Your portfolio starts empty/i)).toBeInTheDocument();
  });

  it('renders the "Add your first experience" CTA button', () => {
    renderComponent();
    expect(screen.getByRole('button', { name: /Add your first experience/i })).toBeInTheDocument();
  });

  it('renders the "How it works" section', () => {
    renderComponent();
    expect(screen.getByText(/How it works/i)).toBeInTheDocument();
  });

  it('renders "+" buttons for each category', () => {
    renderComponent();
    for (const cat of categories) {
      expect(screen.getByRole('button', { name: `Add ${cat.name}` })).toBeInTheDocument();
    }
  });

  it('does not render the admin message', () => {
    renderComponent();
    expect(screen.queryByText(/Admin account/i)).not.toBeInTheDocument();
  });
});

describe('HomeEmptyState — isAdmin=true', () => {
  it('renders the "Admin account" card', () => {
    renderComponent({ isAdmin: true });
    expect(screen.getByText(/Admin account/i)).toBeInTheDocument();
  });

  it('renders the admin panel link', () => {
    renderComponent({ isAdmin: true });
    const link = screen.getByRole('link', { name: /admin panel/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/admin');
  });

  it('does not render the hero card headline', () => {
    renderComponent({ isAdmin: true });
    expect(screen.queryByText(/Your portfolio starts empty/i)).not.toBeInTheDocument();
  });

  it('does not render the "Add your first experience" button', () => {
    renderComponent({ isAdmin: true });
    expect(screen.queryByRole('button', { name: /Add your first experience/i })).not.toBeInTheDocument();
  });

  it('does not render the "How it works" section', () => {
    renderComponent({ isAdmin: true });
    expect(screen.queryByText(/How it works/i)).not.toBeInTheDocument();
  });

  it('does not render category "+" buttons', () => {
    renderComponent({ isAdmin: true });
    for (const cat of categories) {
      expect(screen.queryByRole('button', { name: `Add ${cat.name}` })).not.toBeInTheDocument();
    }
  });

  it('still renders the greeting', () => {
    renderComponent({ isAdmin: true });
    expect(screen.getByRole('heading', { name: /Welcome, Test User/i })).toBeInTheDocument();
  });
});
