import { useState } from 'react';
import { Controller } from 'react-hook-form';
import type {
  Control,
  UseFormSetValue,
  UseFormSetError,
  UseFormClearErrors,
} from 'react-hook-form';
import type { ExperienceFormValues } from '../forms/experienceFormSchema.js';

type HoursField = 'totalHours' | 'hoursPerWeek' | 'numberOfWeeks';

const ALL_FIELDS: HoursField[] = ['totalHours', 'hoursPerWeek', 'numberOfWeeks'];

export interface HoursTripleProps {
  control: Control<ExperienceFormValues>;
  setValue: UseFormSetValue<ExperienceFormValues>;
  setError: UseFormSetError<ExperienceFormValues>;
  clearErrors: UseFormClearErrors<ExperienceFormValues>;
}

/**
 * HoursTriple — last-edited-two-win coupling.
 *
 * Tracks which field was most recently edited using a priority array (most
 * recent at END). The field absent from the array (or the oldest when all
 * three are dirty) is the derived field.
 *
 * Derivation rules:
 *   totalHours + hoursPerWeek dirty  → derive numberOfWeeks = totalHours / hoursPerWeek  [1,5200], integer
 *   totalHours + numberOfWeeks dirty → derive hoursPerWeek  = totalHours / numberOfWeeks [1,168],  integer
 *   hoursPerWeek + numberOfWeeks dirty → derive totalHours  = hoursPerWeek * numberOfWeeks [1,100000]
 *
 * If derivation produces a non-integer or out-of-range value, setError is
 * called on the derived field and the field value is NOT updated.
 */
export function HoursTriple({ control, setValue, setError, clearErrors }: HoursTripleProps) {
  // Most-recently-edited field is at the END of the array.
  const [priority, setPriority] = useState<HoursField[]>([]);
  // Last-known numeric values for each field.
  const [tracked, setTracked] = useState<Partial<Record<HoursField, number>>>({});

  function onFieldChange(field: HoursField, rawValue: number) {
    const newPriority: HoursField[] = [...priority.filter((f) => f !== field), field];
    const newTracked: Partial<Record<HoursField, number>> = { ...tracked, [field]: rawValue };
    setPriority(newPriority);
    setTracked(newTracked);

    if (newPriority.length < 2) {
      // Only one field dirty — nothing to derive yet.
      return;
    }

    // The derived field is the one absent from the priority list, or if all
    // three are present, the OLDEST (index 0).
    const missingField = ALL_FIELDS.find((f) => !newPriority.includes(f));
    const derivedField: HoursField = missingField ?? newPriority[0];

    // The two active (non-derived) fields must both have tracked values.
    const activeFields = ALL_FIELDS.filter((f) => f !== derivedField) as [HoursField, HoursField];
    const a = newTracked[activeFields[0]];
    const b = newTracked[activeFields[1]];

    if (a === undefined || b === undefined) {
      // One of the active fields hasn't been touched yet — skip derivation.
      return;
    }

    if (derivedField === 'numberOfWeeks') {
      // Derive: totalHours / hoursPerWeek
      const totalHours = newTracked['totalHours']!;
      const hoursPerWeek = newTracked['hoursPerWeek']!;
      const derived = totalHours / hoursPerWeek;
      if (!Number.isInteger(derived) || derived < 1 || derived > 5200) {
        setError('numberOfWeeks', { message: 'Must produce a whole number of weeks' });
        return;
      }
      setValue('numberOfWeeks', derived);
      clearErrors('numberOfWeeks');
    } else if (derivedField === 'hoursPerWeek') {
      // Derive: totalHours / numberOfWeeks
      const totalHours = newTracked['totalHours']!;
      const numberOfWeeks = newTracked['numberOfWeeks']!;
      const derived = totalHours / numberOfWeeks;
      if (!Number.isInteger(derived) || derived < 1 || derived > 168) {
        setError('hoursPerWeek', { message: 'Must produce a whole number of hours per week' });
        return;
      }
      setValue('hoursPerWeek', derived);
      clearErrors('hoursPerWeek');
    } else {
      // derivedField === 'totalHours': derive hoursPerWeek * numberOfWeeks
      const hoursPerWeek = newTracked['hoursPerWeek']!;
      const numberOfWeeks = newTracked['numberOfWeeks']!;
      const derived = hoursPerWeek * numberOfWeeks;
      if (derived < 1 || derived > 100000) {
        setError('totalHours', { message: 'Derived total hours out of range [1, 100000]' });
        return;
      }
      setValue('totalHours', derived);
      clearErrors('totalHours');
    }
  }

  const derivedField: HoursField | null =
    priority.length >= 2
      ? (ALL_FIELDS.find((f) => !priority.includes(f)) ?? priority[0])
      : null;

  return (
    <div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-ink">
            Total Hours <span className="text-danger-700">*</span>
            {derivedField === 'totalHours' && <span className="ml-1 text-xs font-normal text-primary-600">· auto</span>}
          </label>
          <Controller
            name="totalHours"
            control={control}
            render={({ field, fieldState }) => (
              <>
                <input
                  type="number"
                  data-testid="hours-totalHours"
                  data-auto={derivedField === 'totalHours' ? 'true' : undefined}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const num = e.target.valueAsNumber;
                    field.onChange(num);
                    onFieldChange('totalHours', num);
                  }}
                  onBlur={field.onBlur}
                  className={inputClass(derivedField === 'totalHours')}
                  min={1}
                  max={100000}
                />
                {fieldState.error && (
                  <p className="mt-1 text-xs text-danger-700">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>

        <div className="flex-1">
          <label className="block text-sm font-medium text-ink">
            Hours/Week <span className="text-danger-700">*</span>
            {derivedField === 'hoursPerWeek' && <span className="ml-1 text-xs font-normal text-primary-600">· auto</span>}
          </label>
          <Controller
            name="hoursPerWeek"
            control={control}
            render={({ field, fieldState }) => (
              <>
                <input
                  type="number"
                  data-testid="hours-hoursPerWeek"
                  data-auto={derivedField === 'hoursPerWeek' ? 'true' : undefined}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const num = e.target.valueAsNumber;
                    field.onChange(num);
                    onFieldChange('hoursPerWeek', num);
                  }}
                  onBlur={field.onBlur}
                  className={inputClass(derivedField === 'hoursPerWeek')}
                  min={1}
                  max={168}
                />
                {fieldState.error && (
                  <p className="mt-1 text-xs text-danger-700">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>

        <div className="flex-1">
          <label className="block text-sm font-medium text-ink">
            Weeks <span className="text-danger-700">*</span>
            {derivedField === 'numberOfWeeks' && <span className="ml-1 text-xs font-normal text-primary-600">· auto</span>}
          </label>
          <Controller
            name="numberOfWeeks"
            control={control}
            render={({ field, fieldState }) => (
              <>
                <input
                  type="number"
                  data-testid="hours-numberOfWeeks"
                  data-auto={derivedField === 'numberOfWeeks' ? 'true' : undefined}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const num = e.target.valueAsNumber;
                    field.onChange(num);
                    onFieldChange('numberOfWeeks', num);
                  }}
                  onBlur={field.onBlur}
                  className={inputClass(derivedField === 'numberOfWeeks')}
                  min={1}
                  max={5200}
                />
                {fieldState.error && (
                  <p className="mt-1 text-xs text-danger-700">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Enter any two — we calculate the third</p>
    </div>
  );
}

function inputClass(isAuto: boolean): string {
  const base = 'mt-1 w-full rounded-lg px-3 py-2 text-sm tabular-nums';
  return isAuto
    ? `${base} border border-dashed border-[color:var(--color-dashed)] bg-app-bg text-primary-600 font-semibold`
    : `${base} border-[1.5px] border-primary-500 text-ink`;
}
