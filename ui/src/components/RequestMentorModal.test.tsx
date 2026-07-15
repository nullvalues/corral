import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RequestMentorModal } from './RequestMentorModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <RequestMentorModal onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

describe('RequestMentorModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders email input and submit button', () => {
    renderModal();
    expect(screen.getByLabelText(/mentor email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows success message on successful submission', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'grant-1', status: 'pending' }),
    } as Response);

    renderModal();

    const input = screen.getByLabelText(/mentor email/i);
    fireEvent.change(input, { target: { value: 'mentor@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => {
      expect(screen.getByText('Request sent — awaiting admin approval')).toBeInTheDocument();
    });
  });

  it('shows 409 conflict error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
    } as Response);

    renderModal();

    const input = screen.getByLabelText(/mentor email/i);
    fireEvent.change(input, { target: { value: 'mentor@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => {
      expect(
        screen.getByText('You already have a pending or active grant with this mentor'),
      ).toBeInTheDocument();
    });
  });

  it('shows 404 not found error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    renderModal();

    const input = screen.getByLabelText(/mentor email/i);
    fireEvent.change(input, { target: { value: 'nobody@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => {
      expect(screen.getByText('No user found with that email')).toBeInTheDocument();
    });
  });

  it('submit button is disabled when email is empty', () => {
    renderModal();
    const submitButton = screen.getByRole('button', { name: /send request/i });
    expect(submitButton).toBeDisabled();
  });

  it('submit button is enabled when email has a value', () => {
    renderModal();
    const input = screen.getByLabelText(/mentor email/i);
    fireEvent.change(input, { target: { value: 'mentor@example.com' } });
    const submitButton = screen.getByRole('button', { name: /send request/i });
    expect(submitButton).not.toBeDisabled();
  });
});
