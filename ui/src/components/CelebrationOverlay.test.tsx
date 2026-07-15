import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CelebrationOverlay } from './CelebrationOverlay.js';

describe('CelebrationOverlay', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the GOAL REACHED eyebrow', () => {
    render(
      <CelebrationOverlay
        categoryName="Animal/Veterinary Science"
        onShare={() => {}}
        onKeepBuilding={() => {}}
      />,
    );
    expect(screen.getByText(/goal reached/i)).toBeInTheDocument();
  });

  it('renders the Share progress CTA', () => {
    render(
      <CelebrationOverlay
        categoryName="Animal/Veterinary Science"
        onShare={() => {}}
        onKeepBuilding={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /share progress with my mentor/i }),
    ).toBeInTheDocument();
  });

  it('renders the Keep building CTA', () => {
    render(
      <CelebrationOverlay
        categoryName="Animal/Veterinary Science"
        onShare={() => {}}
        onKeepBuilding={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /keep building/i }),
    ).toBeInTheDocument();
  });

  it('calls onKeepBuilding when Keep building is clicked', () => {
    const onKeepBuilding = vi.fn();
    render(
      <CelebrationOverlay
        categoryName="Animal/Veterinary Science"
        onShare={() => {}}
        onKeepBuilding={onKeepBuilding}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /keep building/i }));
    expect(onKeepBuilding).toHaveBeenCalledTimes(1);
  });

  it('renders the category name in the headline', () => {
    render(
      <CelebrationOverlay
        categoryName="Research"
        onShare={() => {}}
        onKeepBuilding={() => {}}
      />,
    );
    expect(screen.getByText(/you hit your research goal/i)).toBeInTheDocument();
  });
});
