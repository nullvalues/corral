import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AuthLayout } from './AuthLayout.js';

afterEach(cleanup);

describe('AuthLayout', () => {
  it('renders the brand lockup and the page content', () => {
    render(
      <AuthLayout>
        <h1>Sign in</h1>
      </AuthLayout>,
    );
    expect(screen.getByText('Corral Talent')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
