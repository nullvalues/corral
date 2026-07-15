import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Modal } from './Modal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Modal', () => {
  it('renders children', () => {
    render(
      <Modal onClose={vi.fn()}>
        <p>Modal content</p>
      </Modal>,
    );
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Modal title="Test Title" onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('does not render title element when title is not provided', () => {
    render(
      <Modal onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when panel content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <p>Panel content</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText('Panel content'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
