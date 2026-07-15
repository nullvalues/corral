import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card p-6 shadow-[0_50px_90px_rgba(20,15,10,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
        )}
        {children}
      </div>
    </div>
  );
}
