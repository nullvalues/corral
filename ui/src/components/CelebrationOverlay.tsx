/**
 * CelebrationOverlay — A5 full-screen modal displayed when a user crosses a
 * category goal for the first time.
 *
 * Props:
 *   categoryName   — display name of the category whose goal was just reached
 *   onShare        — callback when "Share progress with my mentor" is clicked
 *   onKeepBuilding — callback when "Keep building" is clicked
 *
 * Both CTAs call the hook's dismiss() before any navigation. The caller is
 * responsible for wiring navigation (e.g. navigate('/mentor-status')) inside onShare.
 */
interface Props {
  categoryName: string;
  onShare: () => void;
  onKeepBuilding: () => void;
}

// Confetti chip colours and positions — static so they don't re-render on every tick
const CONFETTI = [
  { color: '#F97316', top: '8%', left: '12%', rotate: -20, size: 10, height: 18 },
  { color: '#FCD34D', top: '14%', left: '80%', rotate: 35, size: 8, height: 14 },
  { color: '#34D399', top: '20%', left: '55%', rotate: 10, size: 10, height: 16 },
  { color: '#60A5FA', top: '30%', left: '5%', rotate: -45, size: 8, height: 12 },
  { color: '#F472B6', top: '10%', left: '40%', rotate: 55, size: 9, height: 15 },
  { color: '#FCD34D', top: '70%', left: '88%', rotate: -30, size: 8, height: 14 },
  { color: '#F97316', top: '75%', left: '15%', rotate: 60, size: 10, height: 18 },
  { color: '#34D399', top: '80%', left: '70%', rotate: -15, size: 9, height: 15 },
  { color: '#60A5FA', top: '65%', left: '48%', rotate: 40, size: 8, height: 12 },
  { color: '#F472B6', top: '55%', left: '3%', rotate: -55, size: 10, height: 16 },
  { color: '#F97316', top: '40%', left: '92%', rotate: 20, size: 8, height: 13 },
  { color: '#FCD34D', top: '50%', left: '62%', rotate: -10, size: 9, height: 14 },
];

export function CelebrationOverlay({ categoryName, onShare, onKeepBuilding }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Goal reached"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'radial-gradient(120% 80% at 50% 12%, #2A1C0E, #14110F)',
      }}
    >
      {/* Scattered confetti chips */}
      {CONFETTI.map((chip, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: chip.top,
            left: chip.left,
            width: chip.size,
            height: chip.height,
            backgroundColor: chip.color,
            borderRadius: 3,
            transform: `rotate(${chip.rotate}deg)`,
            opacity: 0.85,
          }}
        />
      ))}

      {/* Centered content card */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-8 text-center max-w-sm w-full">
        {/* Medallion: orange disc + white check */}
        <div className="w-24 h-24 rounded-full bg-primary-500 flex items-center justify-center shadow-lg">
          <svg
            aria-hidden="true"
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
          >
            <path
              d="M10 25L20 35L38 14"
              stroke="white"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Eyebrow */}
        <p className="text-primary-500 text-xs font-bold tracking-widest uppercase">
          Goal Reached
        </p>

        {/* Headline */}
        <h1 className="font-display text-[28px] font-extrabold text-white leading-tight">
          You hit your {categoryName} goal!
        </h1>

        {/* Support copy */}
        <p className="text-white/60 text-[15px] leading-relaxed">
          You&apos;ve reached the hour target for{' '}
          <span className="text-white font-semibold">{categoryName}</span>.
          Keep going — every experience moves you closer to your application.
        </p>

        {/* CTAs */}
        <div className="flex flex-col gap-3 w-full mt-2">
          <button
            type="button"
            onClick={onShare}
            className="w-full rounded-[14px] bg-primary-500 py-3.5 font-semibold text-white text-[15px]"
          >
            Share progress with my mentor
          </button>
          <button
            type="button"
            onClick={onKeepBuilding}
            className="w-full rounded-[14px] border border-white/20 py-3.5 font-semibold text-white/80 text-[15px]"
          >
            Keep building
          </button>
        </div>
      </div>
    </div>
  );
}
