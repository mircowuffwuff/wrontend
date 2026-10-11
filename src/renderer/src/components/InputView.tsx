// a tool's input as readable fields: a file's path on one line, its content with real line breaks

function Value({ value }: { value: unknown }) {
  if (typeof value === 'string') return <pre className="mono field-value">{value}</pre>;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return <span className="mono">{String(value)}</span>;
  return <pre className="mono field-value">{JSON.stringify(value, null, 2)}</pre>;
}

export function InputView({ input }: { input: unknown }) {
  if (input === undefined) return null;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return <Value value={input} />;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <div className="fields">
      {entries.map(([key, value]) => {
        const short = typeof value !== 'object' && !(typeof value === 'string' && value.includes('\n')) && String(value).length < 120;
        return (
          <div key={key} className={`field${short ? ' inline' : ''}`}>
            <span className="field-key">{key.replace(/_/g, ' ')}</span>
            {short ? <span className="mono field-short">{String(value)}</span> : <Value value={value} />}
          </div>
        );
      })}
    </div>
  );
}
