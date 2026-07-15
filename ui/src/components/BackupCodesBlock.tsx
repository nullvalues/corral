import { useState } from 'react';
import type { ReactElement } from 'react';

interface BackupCodesBlockProps {
  codes: string[];
}

/**
 * One-time display block for backup codes.
 * Shows each code in a monospace list with a "Copy all" button and a security warning.
 * This block does NOT persist codes anywhere — once the user navigates away they are gone.
 */
export function BackupCodesBlock({ codes }: BackupCodesBlockProps): ReactElement {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      data-testid="backup-codes-block"
      className="rounded-lg border border-warning-300 bg-warning-50 p-4"
    >
      <p className="mb-2 text-sm font-semibold text-warning-700">
        Save these backup codes now — they are shown only once and cannot be retrieved later.
        Store them somewhere secure.
      </p>
      <ul className="mb-3 list-none space-y-1" data-testid="backup-codes-list">
        {codes.map((code) => (
          <li key={code} className="font-mono text-sm text-text-default">
            {code}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={handleCopy}
        data-testid="backup-codes-copy-btn"
        className="rounded bg-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-focus-ring"
      >
        {copied ? 'Copied!' : 'Copy to clipboard'}
      </button>
    </div>
  );
}
