import { useState } from 'react';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCategories } from '../hooks/useCategories.js';
import type { Category } from '../hooks/useCategories.js';
import { useCreateCategory } from '../hooks/useCreateCategory.js';
import { useUpdateCategory } from '../hooks/useUpdateCategory.js';

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const categoryFormSchema = z.object({
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z][a-z0-9-]{0,63}$/, 'Slug must start with a letter and contain only lowercase letters, digits, or hyphens (max 64 chars)'),
  name: z.string().min(1, 'Name is required').max(128, 'Name must be 128 characters or fewer'),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
  goalHours: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.union([z.null(), z.coerce.number().int().nonnegative()])
  ),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

// ---------------------------------------------------------------------------
// Inline category form
// ---------------------------------------------------------------------------

interface CategoryFormProps {
  defaultValues?: Partial<CategoryFormValues>;
  onSubmit: (data: CategoryFormValues) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}

function CategoryForm({
  defaultValues,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel,
}: CategoryFormProps): ReactElement {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(categoryFormSchema as any) as unknown as Resolver<CategoryFormValues>,
    defaultValues: {
      slug: '',
      name: '',
      sortOrder: 0,
      isActive: true,
      goalHours: null,
      ...defaultValues,
    },
  });

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      className="flex flex-col gap-3 rounded border border-surface-muted bg-surface-card p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-text-default">
          Slug <span className="text-danger-700">*</span>
        </label>
        <input
          type="text"
          {...register('slug')}
          className="rounded border border-surface-muted px-3 py-2 text-sm text-text-default"
          placeholder="e.g. clinical-work"
        />
        {errors.slug && (
          <p className="text-xs text-danger-700">{errors.slug.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-text-default">
          Name <span className="text-danger-700">*</span>
        </label>
        <input
          type="text"
          {...register('name')}
          className="rounded border border-surface-muted px-3 py-2 text-sm text-text-default"
          placeholder="Display name"
        />
        {errors.name && (
          <p className="text-xs text-danger-700">{errors.name.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-text-default">Sort Order</label>
        <input
          type="number"
          {...register('sortOrder', { valueAsNumber: true })}
          className="rounded border border-surface-muted px-3 py-2 text-sm text-text-default"
          placeholder="0"
        />
        {errors.sortOrder && (
          <p className="text-xs text-danger-700">{errors.sortOrder.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-text-default">Goal hours</label>
        <input
          type="number"
          min={0}
          {...register('goalHours')}
          className="rounded border border-surface-muted px-3 py-2 text-sm text-text-default"
          placeholder="Blank = no minimum"
        />
        <p className="text-xs text-text-muted">Leave blank for no hour minimum.</p>
        {errors.goalHours && <p className="text-xs text-danger-700">{errors.goalHours.message}</p>}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          {...register('isActive')}
          className="rounded"
        />
        <label htmlFor="isActive" className="text-sm text-text-default">
          Active
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-surface-muted px-4 py-2 text-sm text-text-default hover:bg-surface-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-text-inverted hover:bg-primary-600 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Active / Inactive badge
// ---------------------------------------------------------------------------

function ActiveBadge({ isActive }: { isActive: boolean }): ReactElement {
  return isActive ? (
    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
      Active
    </span>
  ) : (
    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-muted">
      Inactive
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type FormMode =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; category: Category };

export function CategoriesAdminPage(): ReactElement {
  const { data: categories, isLoading, isError } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [mode, setMode] = useState<FormMode>({ type: 'none' });

  const handleCreate = async (data: CategoryFormValues): Promise<void> => {
    await createCategory.mutateAsync(data);
    setMode({ type: 'none' });
  };

  const handleEdit = async (id: string, data: CategoryFormValues): Promise<void> => {
    await updateCategory.mutateAsync({ id, data });
    setMode({ type: 'none' });
  };

  const handleDeactivate = async (category: Category): Promise<void> => {
    await updateCategory.mutateAsync({ id: category.id, data: { isActive: false } });
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-default">Experience Categories</h1>
        {mode.type === 'none' && (
          <button
            onClick={() => setMode({ type: 'create' })}
            className="rounded bg-primary-500 px-4 py-2 text-sm font-medium text-text-inverted hover:bg-primary-600"
          >
            Create
          </button>
        )}
      </div>

      {mode.type === 'create' && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-text-muted uppercase tracking-wide">
            New Category
          </h2>
          <CategoryForm
            submitLabel="Create Category"
            isSubmitting={createCategory.isPending}
            onSubmit={handleCreate}
            onCancel={() => setMode({ type: 'none' })}
          />
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-text-muted">Loading categories…</p>
      )}

      {isError && (
        <p className="text-sm text-danger-700">Failed to load categories.</p>
      )}

      {!isLoading && !isError && categories && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-surface-muted text-left">
                <th className="pb-2 pr-4 font-medium text-text-muted">Slug</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Name</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Sort Order</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Goal hours</th>
                <th className="pb-2 pr-4 font-medium text-text-muted">Status</th>
                <th className="pb-2 font-medium text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id} className="border-b border-surface-muted">
                  <td className="py-3 pr-4 font-mono text-text-default">{cat.slug}</td>
                  <td className="py-3 pr-4 text-text-default">{cat.name}</td>
                  <td className="py-3 pr-4 text-text-default">{cat.sortOrder}</td>
                  <td className="py-3 pr-4 text-text-default tabular-nums">
                    {cat.goalHours == null ? <span className="text-text-muted">No minimum</span> : cat.goalHours}
                  </td>
                  <td className="py-3 pr-4">
                    <ActiveBadge isActive={cat.isActive} />
                  </td>
                  <td className="py-3">
                    {mode.type === 'edit' && mode.category.id === cat.id ? (
                      <div className="mt-2">
                        <CategoryForm
                          defaultValues={{
                            slug: cat.slug,
                            name: cat.name,
                            sortOrder: cat.sortOrder,
                            isActive: cat.isActive,
                            goalHours: cat.goalHours,
                          }}
                          submitLabel="Save Changes"
                          isSubmitting={updateCategory.isPending}
                          onSubmit={(data) => handleEdit(cat.id, data)}
                          onCancel={() => setMode({ type: 'none' })}
                        />
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setMode({ type: 'edit', category: cat })}
                          className="rounded border border-surface-muted px-3 py-1 text-xs text-text-default hover:bg-surface-muted"
                        >
                          Edit
                        </button>
                        {cat.isActive && (
                          <button
                            onClick={() => void handleDeactivate(cat)}
                            className="rounded border border-danger-500 px-3 py-1 text-xs text-danger-700 hover:bg-danger-50"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {categories.length === 0 && (
            <p className="mt-4 text-sm text-text-muted">No categories yet. Create the first one.</p>
          )}
        </div>
      )}
    </div>
  );
}
