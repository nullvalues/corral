import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.fn(() => Promise.resolve({}));

const useReadinessConfigMock = vi.fn();
const useUpdateReadinessConfigMock = vi.fn();

vi.mock('../hooks/useReadinessConfig.js', () => ({
  useReadinessConfig: () => useReadinessConfigMock(),
}));

vi.mock('../hooks/useUpdateReadinessConfig.js', () => ({
  useUpdateReadinessConfig: () => useUpdateReadinessConfigMock(),
}));

import { ReadinessSettingsPage } from './ReadinessSettingsPage.js';

const CONFIG = { wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 };

beforeEach(() => {
  mutateAsync.mockClear();
  useReadinessConfigMock.mockReturnValue({
    data: CONFIG,
    isLoading: false,
    isError: false,
  });
  useUpdateReadinessConfigMock.mockReturnValue({
    mutateAsync,
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
});

function getSaveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
}

describe('ReadinessSettingsPage', () => {
  it('pre-fills inputs from the fetched config', () => {
    render(<ReadinessSettingsPage />);
    expect((screen.getByLabelText('Goal progress') as HTMLInputElement).value).toBe('0.6');
    expect((screen.getByLabelText('Verified ratio') as HTMLInputElement).value).toBe('0.25');
    expect((screen.getByLabelText('Breadth') as HTMLInputElement).value).toBe('0.15');
    expect((screen.getByLabelText('Platinum mentor threshold (hours)') as HTMLInputElement).value).toBe('1000');
  });

  it('enables Save when the weights sum to 1', () => {
    render(<ReadinessSettingsPage />);
    expect(getSaveButton().disabled).toBe(false);
  });

  it('disables Save and shows the sum hint when weights no longer sum to 1', () => {
    render(<ReadinessSettingsPage />);
    fireEvent.change(screen.getByLabelText('Goal progress'), { target: { value: '0.5' } });
    // sum is now 0.9
    expect(getSaveButton().disabled).toBe(true);
    expect(screen.getByTestId('weight-sum-hint').textContent).toContain('0.900');
  });

  it('calls the update mutation with the three weights and platinumHours on a valid Save', async () => {
    render(<ReadinessSettingsPage />);
    fireEvent.click(getSaveButton());
    await Promise.resolve();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15, platinumHours: 1000 });
  });

  it('disables Save when platinumHours is 0', () => {
    render(<ReadinessSettingsPage />);
    fireEvent.change(screen.getByLabelText('Platinum mentor threshold (hours)'), { target: { value: '0' } });
    expect(getSaveButton().disabled).toBe(true);
  });

  it('disables Save when platinumHours is negative', () => {
    render(<ReadinessSettingsPage />);
    fireEvent.change(screen.getByLabelText('Platinum mentor threshold (hours)'), { target: { value: '-5' } });
    expect(getSaveButton().disabled).toBe(true);
  });

  it('enables Save with a custom positive platinumHours', () => {
    render(<ReadinessSettingsPage />);
    fireEvent.change(screen.getByLabelText('Platinum mentor threshold (hours)'), { target: { value: '500' } });
    expect(getSaveButton().disabled).toBe(false);
  });
});
