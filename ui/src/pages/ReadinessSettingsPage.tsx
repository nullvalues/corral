import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useReadinessConfig } from '../hooks/useReadinessConfig.js';
import { useUpdateReadinessConfig } from '../hooks/useUpdateReadinessConfig.js';

interface WeightFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function WeightField({ id, label, value, onChange }: WeightFieldProps): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text-default">
        {label}
      </label>
      <input
        id={id}
        type="number"
        step="0.01"
        min={0}
        max={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-surface-muted px-3 py-2 text-sm text-text-default tabular-nums"
      />
    </div>
  );
}

export function ReadinessSettingsPage(): ReactElement {
  const { data: config, isLoading, isError } = useReadinessConfig();
  const updateConfig = useUpdateReadinessConfig();

  const [wGoal, setWGoal] = useState('');
  const [wVerified, setWVerified] = useState('');
  const [wBreadth, setWBreadth] = useState('');
  const [platinumHours, setPlatinumHours] = useState('1000');
  const [saved, setSaved] = useState(false);

  // Pre-fill from the fetched config once it arrives (and after refetch).
  useEffect(() => {
    if (config) {
      setWGoal(String(config.wGoal));
      setWVerified(String(config.wVerified));
      setWBreadth(String(config.wBreadth));
      setPlatinumHours(String(config.platinumHours));
    }
  }, [config]);

  const nGoal = Number(wGoal);
  const nVerified = Number(wVerified);
  const nBreadth = Number(wBreadth);
  const nPlatinum = Number(platinumHours);
  const allNumeric = [wGoal, wVerified, wBreadth].every(
    (s) => s.trim() !== '' && Number.isFinite(Number(s))
  );
  const platinumValid =
    platinumHours.trim() !== '' &&
    Number.isFinite(nPlatinum) &&
    Number.isInteger(nPlatinum) &&
    nPlatinum > 0;
  const sum = nGoal + nVerified + nBreadth;
  const valid =
    allNumeric &&
    [nGoal, nVerified, nBreadth].every((w) => w >= 0 && w <= 1) &&
    Math.abs(sum - 1) <= 0.001 &&
    platinumValid;

  const handleSubmit = async (): Promise<void> => {
    if (!valid) return;
    setSaved(false);
    await updateConfig.mutateAsync({
      wGoal: nGoal,
      wVerified: nVerified,
      wBreadth: nBreadth,
      platinumHours: nPlatinum,
    });
    setSaved(true);
  };

  if (isLoading) {
    return <p className="p-6 text-sm text-text-muted">Loading readiness settings…</p>;
  }

  if (isError) {
    return <p className="p-6 text-sm text-danger-700">Failed to load readiness settings.</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-text-default">Readiness weights</h1>
      <p className="mb-4 text-sm text-text-muted">
        Tune how the readiness score weighs goal progress, verified ratio, and breadth. Weights must
        sum to 1.00.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="flex max-w-md flex-col gap-3 rounded border border-surface-muted bg-surface-card p-4"
      >
        <WeightField id="wGoal" label="Goal progress" value={wGoal} onChange={setWGoal} />
        <WeightField id="wVerified" label="Verified ratio" value={wVerified} onChange={setWVerified} />
        <WeightField id="wBreadth" label="Breadth" value={wBreadth} onChange={setWBreadth} />

        <p
          className={`text-sm tabular-nums ${valid ? 'text-text-muted' : 'text-danger-700'}`}
          data-testid="weight-sum-hint"
        >
          Weights must sum to 1.00 (currently {sum.toFixed(3)})
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="platinumHours" className="text-sm font-medium text-text-default">
            Platinum mentor threshold (hours)
          </label>
          <input
            id="platinumHours"
            type="number"
            step="1"
            min={1}
            value={platinumHours}
            onChange={(e) => setPlatinumHours(e.target.value)}
            className="rounded border border-surface-muted px-3 py-2 text-sm text-text-default tabular-nums"
          />
          {!platinumValid && platinumHours.trim() !== '' && (
            <p className="text-xs text-danger-700">Must be a positive whole number.</p>
          )}
        </div>

        {saved && !updateConfig.isPending && (
          <p className="text-sm text-success-700" role="status">
            Saved.
          </p>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={!valid || updateConfig.isPending}
            className="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-text-inverted hover:bg-primary-600 disabled:opacity-50"
          >
            {updateConfig.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
