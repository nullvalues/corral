import { useState, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import type { Resolver, FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { DutiesEditor } from './DutiesEditor.js';
import { HoursTriple } from './HoursTriple.js';
import { experienceFormSchema, type ExperienceFormValues } from '../forms/experienceFormSchema.js';
import { useCreateExperience } from '../hooks/useCreateExperience.js';
import { useUpdateExperience } from '../hooks/useUpdateExperience.js';
import { queryKeys } from '../lib/queryKeys.js';
import type { paths } from '../api-types.js';

function getDraftKey(userId: string, experienceId?: string): string {
  return experienceId
    ? `asp:draft:${userId}:${experienceId}`
    : `asp:draft:${userId}:new`;
}

interface DraftPayload {
  values: Partial<ExperienceFormValues>;
  step?: number;
}

type Category =
  paths['/api/experience-categories']['get']['responses'][200]['content']['application/json'][number];

interface ExperienceFormProps {
  categoryId: string;
  ownerUserId: string;
  experienceId?: string;
  defaultValues?: Partial<ExperienceFormValues>;
  onSuccess: () => void;
  onCancel: () => void;
}

interface ApiErrorBody {
  issues?: Array<{ path: string[]; message: string }>;
}

interface MutationError extends Error {
  status: number;
  body: ApiErrorBody;
}

function isMutationError(e: unknown): e is MutationError {
  return e instanceof Error && 'status' in e && 'body' in e;
}

export function ExperienceForm({
  categoryId,
  ownerUserId,
  experienceId,
  defaultValues,
  onSuccess,
  onCancel,
}: ExperienceFormProps) {
  const draftKey = getDraftKey(ownerUserId, experienceId);

  // Attempt to restore draft on mount — returns undefined if none/corrupt
  const restoredDraft = (() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as DraftPayload;
      if (parsed && typeof parsed === 'object' && 'values' in parsed) {
        return parsed;
      }
      localStorage.removeItem(draftKey);
      return undefined;
    } catch {
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      return undefined;
    }
  })();

  const [draftRestored, setDraftRestored] = useState(false);

  const mergedDefaults: Partial<ExperienceFormValues> = {
    categoryId,
    isCurrent: false,
    receivedAcademicCredit: false,
    receivedSalaryOrPayment: false,
    isVolunteer: false,
    isMostImportant: false,
    permissionToContact: false,
    totalHours: 1,
    hoursPerWeek: 1,
    numberOfWeeks: 1,
    dutiesNarrative: '',
    ...defaultValues,
    ...(restoredDraft?.values ?? {}),
  };

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ExperienceFormValues>({
    // Cast needed: @hookform/resolvers v3 type signature differs from react-hook-form v7's Resolver generic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(experienceFormSchema as any) as unknown as Resolver<ExperienceFormValues>,
    defaultValues: mergedDefaults,
  });

  const [step, setStep] = useState<number>(restoredDraft?.step ?? 0);

  // Show "Draft restored" toast once when a draft was loaded
  useEffect(() => {
    if (restoredDraft) {
      setDraftRestored(true);
      const t = setTimeout(() => setDraftRestored(false), 3000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave: watch all values, debounced at 500ms — persist draft to localStorage
  const allValues = watch();
  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      try {
        const payload: DraftPayload = { values: allValues, step };
        localStorage.setItem(draftKey, JSON.stringify(payload));
      } catch { /* quota exceeded or private mode — ignore */ }
    }, 500);

    // Cleanup on unmount — do NOT clear the draft (that is the point)
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allValues, step, draftKey]);

  const clearDraft = () => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  };

  const dutiesValue = watch('dutiesNarrative') ?? '';

  const createMutation = useCreateExperience(ownerUserId);
  const updateMutation = useUpdateExperience(ownerUserId);

  const onSubmit = async (data: ExperienceFormValues) => {
    try {
      if (experienceId) {
        await updateMutation.mutateAsync({ id: experienceId, data });
      } else {
        await createMutation.mutateAsync(data);
      }
      clearDraft();
      onSuccess();
    } catch (e) {
      if (isMutationError(e) && (e.status === 400 || e.status === 422)) {
        const issues = e.body?.issues ?? [];
        for (const issue of issues) {
          const fieldName = issue.path[0] as keyof ExperienceFormValues;
          if (fieldName) {
            setError(fieldName, { message: issue.message });
          }
        }
      }
    }
  };

  const handleCancel = () => {
    clearDraft();
    onCancel();
  };

  const { data: categories } = useQuery<Category[]>({
    queryKey: queryKeys.categories,
    queryFn: async () => {
      const res = await fetch('/api/experience-categories', { credentials: 'include' });
      if (!res.ok) throw { status: res.status };
      return res.json() as Promise<Category[]>;
    },
  });
  const categoriesList: Category[] = Array.isArray(categories) ? categories : [];
  const activeCategory = categoriesList.find((c) => c.id === categoryId);
  const categoryName = activeCategory?.name ?? 'Category';
  const categoryInitials = categoryName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const STEP_TITLES = ['Basics', 'Hours & dates', 'Details'] as const;

  const STEP_FIELDS: Record<number, (keyof ExperienceFormValues)[]> = {
    0: ['organization', 'position', 'frequency', 'categoryId'],
    1: ['totalHours', 'hoursPerWeek', 'numberOfWeeks', 'startDate', 'endDate'],
    2: ['dutiesNarrative', 'stateProvince', 'country', 'isCurrent',
        'receivedAcademicCredit', 'receivedSalaryOrPayment', 'isVolunteer',
        'isMostImportant', 'permissionToContact', 'contactFirstName',
        'contactLastName', 'contactTitle', 'contactEmail', 'contactPhone'],
  };

  const onValidationError = (errs: FieldErrors<ExperienceFormValues>) => {
    for (let s = 0; s <= 2; s++) {
      if (STEP_FIELDS[s]!.some((f) => f in errs)) {
        setStep(s);
        return;
      }
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit, onValidationError)(e)} className="flex flex-col gap-4">
      <input type="hidden" {...register('categoryId')} />

      {/* Sticky header */}
      <header className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-hairline bg-card px-6 py-3">
        <button type="button" onClick={handleCancel} className="text-sm text-muted">
          Cancel
        </button>
        <span className="font-display text-base font-bold text-ink">
          {experienceId ? 'Edit experience' : 'New experience'}
        </span>
        <button
          type="submit"
          disabled={isSubmitting || dutiesValue.length > 8192}
          className="text-sm font-semibold text-primary-600 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : experienceId ? 'Save Changes' : 'Add Experience'}
        </button>
      </header>

      {/* Draft restored toast */}
      {draftRestored && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg bg-primary-100 px-3 py-2 text-sm text-primary-800"
        >
          Draft restored
        </div>
      )}

      {/* Step progress bar */}
      <div className="mb-1 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary-500' : 'bg-track'}`}
          />
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">
        Step {step + 1} of 3 · {STEP_TITLES[step]}
      </p>

      {/* Category chip */}
      <div className="mb-4 flex items-center gap-3 rounded-xl bg-primary-100 px-3 py-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-xs font-bold text-text-inverted">
          {categoryInitials}
        </span>
        <span>
          <span className="block text-[10px] font-bold uppercase tracking-wide text-primary-800">
            Category
          </span>
          <span className="block text-sm font-semibold text-ink">{categoryName}</span>
        </span>
      </div>

      {/* Step 0: Basics — organization, position, frequency */}
      <div className={step === 0 ? 'flex flex-col gap-4' : 'hidden'}>
        <div>
          <label className="block text-sm font-medium text-text-default">
            Organization <span className="text-danger-700">*</span>
          </label>
          <input
            type="text"
            {...register('organization')}
            className="mt-1 w-full rounded border border-surface-muted px-3 py-2 text-sm"
            placeholder="Organization name"
          />
          {errors.organization && (
            <p className="mt-1 text-xs text-danger-700">{errors.organization.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-default">
            Position <span className="text-danger-700">*</span>
          </label>
          <input
            type="text"
            {...register('position')}
            className="mt-1 w-full rounded border border-surface-muted px-3 py-2 text-sm"
            placeholder="Your role or title"
          />
          {errors.position && (
            <p className="mt-1 text-xs text-danger-700">{errors.position.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-default">Frequency</label>
          <select
            {...register('frequency')}
            className="mt-1 w-full rounded border border-surface-muted px-3 py-2 text-sm"
          >
            <option value="">— select frequency —</option>
            <option value="temporary">Temporary</option>
            <option value="recurring">Recurring</option>
            <option value="ongoing">Ongoing</option>
          </select>
          <p className="mt-1 text-xs text-text-muted">
            Temporary — short-term or one-off; Recurring — periodic but not
            continuous; Ongoing — currently active.
          </p>
          {errors.frequency && (
            <p className="mt-1 text-xs text-danger-700">{errors.frequency.message}</p>
          )}
        </div>
      </div>

      {/* Step 1: Hours & dates — HoursTriple + start/end dates */}
      <div className={step === 1 ? 'flex flex-col gap-4' : 'hidden'}>
        <HoursTriple
          control={control}
          setValue={setValue}
          setError={setError}
          clearErrors={clearErrors}
        />

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-text-default">
              Start Date <span className="text-danger-700">*</span>
            </label>
            <input
              type="date"
              {...register('startDate')}
              className="mt-1 w-full rounded border border-surface-muted px-3 py-2 text-sm"
            />
            {errors.startDate && (
              <p className="mt-1 text-xs text-danger-700">{errors.startDate.message}</p>
            )}
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-text-default">End Date</label>
            <input
              type="date"
              {...register('endDate')}
              className="mt-1 w-full rounded border border-surface-muted px-3 py-2 text-sm"
            />
            {errors.endDate && (
              <p className="mt-1 text-xs text-danger-700">{errors.endDate.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Step 2: Details — duties, location, attestations (iOS toggles), contact */}
      <div className={step === 2 ? 'flex flex-col gap-4' : 'hidden'}>
        <div>
          <label className="block text-sm font-medium text-text-default">
            Duties Narrative <span className="text-danger-700">*</span>
          </label>
          <Controller
            name="dutiesNarrative"
            control={control}
            defaultValue=""
            render={({ field }) => (
              <DutiesEditor
                value={field.value ?? ''}
                onChange={field.onChange}
                error={errors.dutiesNarrative?.message}
              />
            )}
          />
        </div>

        <fieldset className="rounded border border-surface-muted p-3">
          <legend className="text-sm font-medium text-text-default">Location</legend>
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              {...register('stateProvince')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="State / Province"
            />
            <input
              type="text"
              {...register('country')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="Country"
            />
          </div>
        </fieldset>

        <fieldset className="rounded border border-surface-muted p-3">
          <legend className="text-sm font-medium text-text-default">Attestations</legend>
          <div className="mt-2 flex flex-col gap-2">
            {(
              [
                ['isCurrent', 'Currently active'],
                ['receivedAcademicCredit', 'Received academic credit'],
                ['receivedSalaryOrPayment', 'Received salary or payment'],
                ['isVolunteer', 'Volunteer'],
                ['isMostImportant', 'Most important experience'],
              ] as const
            ).map(([field, label]) => (
              <label
                key={field}
                className="flex items-center justify-between gap-2 border-b border-divider py-2 text-sm text-ink last:border-0"
              >
                <span>{label}</span>
                <span className="relative inline-flex">
                  <input type="checkbox" {...register(field)} className="peer sr-only" />
                  <span className="h-6 w-11 rounded-full bg-track transition-colors peer-checked:bg-primary-500" />
                  <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded border border-surface-muted p-3">
          <legend className="text-sm font-medium text-text-default">Contact</legend>
          <p className="mt-2 text-xs text-text-muted">
            This contact information may be shared with your assigned mentor when
            you enable &lsquo;Permission to contact&rsquo;. It is not visible to
            anyone else.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              {...register('contactFirstName')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="First name"
            />
            <input
              type="text"
              {...register('contactLastName')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="Last name"
            />
            <input
              type="text"
              {...register('contactTitle')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="Contact title"
            />
            <input
              type="email"
              {...register('contactEmail')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="Contact email"
            />
            {errors.contactEmail && (
              <p className="mt-1 text-xs text-danger-700">{errors.contactEmail.message}</p>
            )}
            <input
              type="tel"
              {...register('contactPhone')}
              className="w-full rounded border border-surface-muted px-3 py-2 text-sm"
              placeholder="+1234567890"
            />
            {errors.contactPhone && (
              <p className="mt-1 text-xs text-danger-700">{errors.contactPhone.message}</p>
            )}
            <label className="flex items-center justify-between gap-2 border-b border-divider py-2 text-sm text-ink last:border-0">
              <span>Permission to contact</span>
              <span className="relative inline-flex">
                <input type="checkbox" {...register('permissionToContact')} className="peer sr-only" />
                <span className="h-6 w-11 rounded-full bg-track transition-colors peer-checked:bg-primary-500" />
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      {/* Back/Next navigation row */}
      <div className="mt-2 flex justify-between gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="rounded-xl border border-hairline px-4 py-2 text-sm text-ink disabled:opacity-40"
        >
          Back
        </button>
        {step < 2 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(2, s + 1))}
            className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-text-inverted hover:bg-primary-600"
          >
            Continue
          </button>
        ) : (
          <button
            type="submit"
            disabled={isSubmitting || dutiesValue.length > 8192}
            className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-text-inverted hover:bg-primary-600 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving…' : experienceId ? 'Save Changes' : 'Add Experience'}
          </button>
        )}
      </div>
    </form>
  );
}
