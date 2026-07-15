import { useNavigate } from 'react-router-dom';

interface Props {
  name: string;
  categories: { id: string; name: string; goalHours: number | null }[];
  isAdmin?: boolean;
}

const HOW_IT_WORKS = [
  { step: 1, text: 'Add your experiences across every VMCAS category.' },
  { step: 2, text: 'Get experiences verified by a mentor or supervisor.' },
  { step: 3, text: 'Track your readiness as you close in on each hour goal.' },
];

export function HomeEmptyState({ name, categories, isAdmin = false }: Props) {
  const navigate = useNavigate();
  const add = () => navigate('/experiences');

  return (
    <main className="px-[18px] py-4 flex flex-col gap-6">
      {/* Brand row + greeting */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary-500 flex items-center justify-center">
          <span className="font-display text-white font-extrabold text-lg leading-none">O</span>
        </div>
        <span className="font-semibold text-ink flex-1">Pre-Vet Portfolio</span>
      </div>
      <h1 className="font-display text-[22px] font-bold text-ink leading-snug">
        Welcome, {name || 'there'}
      </h1>

      {isAdmin ? (
        /* Admin branch: show admin message instead of hero/how-it-works/category + buttons */
        <section className="rounded-[24px] bg-surface-card border border-surface-muted p-5 flex flex-col gap-2">
          <p className="font-semibold text-text-default">Admin account</p>
          <p className="text-sm text-text-muted">
            This account has the admin role. Experiences belong to applicant accounts.
            Use the <a href="/admin" className="text-primary-500 underline">admin panel</a> to manage the app.
          </p>
        </section>
      ) : (
        <>
          {/* Hero card */}
          <section className="rounded-[24px] bg-ink p-5 flex flex-col gap-4 text-white">
            {/* 64px orange-tint "+" tile */}
            <button
              type="button"
              onClick={add}
              aria-label="Add experience"
              className="w-16 h-16 rounded-[18px] bg-primary-500/20 flex items-center justify-center text-primary-500 text-4xl font-light self-start"
            >
              +
            </button>
            <h2 className="font-display text-[19px] font-bold leading-snug">
              Your portfolio starts empty. It won&apos;t stay that way.
            </h2>
            <button
              type="button"
              onClick={add}
              className="mt-1 w-full rounded-[13px] bg-primary-500 py-3 font-semibold text-white text-[15px]"
            >
              Add your first experience
            </button>
          </section>

          {/* How it works */}
          <div className="flex flex-col gap-3">
            <h2 className="font-semibold text-ink text-[15px]">How it works</h2>
            <ol className="flex flex-col gap-3">
              {HOW_IT_WORKS.map(({ step, text }) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-primary-500/15 text-primary-500 font-bold text-[13px] flex items-center justify-center shrink-0">
                    {step}
                  </span>
                  <span className="text-ink-soft text-[14px] leading-snug pt-0.5">{text}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Your categories preview */}
          <div className="flex flex-col gap-3">
            <h2 className="font-semibold text-ink text-[15px]">Your categories</h2>
            <div className="flex flex-col gap-[10px]">
              {categories.map((c) => {
                const goal = c.goalHours;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-[18px] border border-dashed border-[--color-dashed] bg-card p-[15px]"
                  >
                    <span className="font-medium text-ink text-[14px]">{c.name}</span>
                    <span className="text-muted text-sm mx-3 shrink-0">
                      {goal === null ? 'No hour minimum' : `0 of ${goal} hr goal`}
                    </span>
                    <button
                      type="button"
                      onClick={add}
                      aria-label={`Add ${c.name}`}
                      className="text-primary-500 text-xl font-light shrink-0"
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
