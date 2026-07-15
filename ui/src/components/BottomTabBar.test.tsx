import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar.js';

describe('BottomTabBar', () => {
  afterEach(() => {
    cleanup();
  });

  function renderBar(initialEntry = '/home') {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <BottomTabBar />
      </MemoryRouter>,
    );
  }

  it('renders all four tab labels', () => {
    renderBar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Mentor')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('marks the Home tab active with the brand-orange treatment when at /home', () => {
    renderBar('/home');
    const homeLink = screen.getByRole('link', { name: /home/i });
    expect(homeLink.className).toContain('text-primary-500');
  });

  it('renders inactive tabs with the muted treatment', () => {
    renderBar('/home');
    const profileLink = screen.getByRole('link', { name: /profile/i });
    expect(profileLink.className).toContain('text-muted');
    expect(profileLink.className).not.toContain('text-primary-500');
  });
});
