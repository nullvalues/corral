interface DutiesEditorProps {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

const MAX = 8192;

export function DutiesEditor({ value, onChange, error }: DutiesEditorProps) {
  const count = value.length;
  const over = count > MAX;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm${over ? ' border-danger-700' : ' border-hairline'}`}
        rows={6}
      />
      <div className={over ? 'text-danger-600' : 'text-text-muted'}>
        {count} / {MAX}
      </div>
      {over && <p className="text-danger-600">Duties must be 8192 characters or fewer</p>}
      {error && !over && <p className="text-danger-600">{error}</p>}
    </div>
  );
}
