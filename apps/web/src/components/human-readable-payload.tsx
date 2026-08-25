import { workflowFieldLabel } from './workflow-schema';

function displayValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '')
    return <span className="qf-empty-value">Not provided</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat().format(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map(String).join(', ');
    }
    return (
      <pre className="qf-code-block qf-code-block--compact">{JSON.stringify(value, null, 2)}</pre>
    );
  }
  return (
    <pre className="qf-code-block qf-code-block--compact">{JSON.stringify(value, null, 2)}</pre>
  );
}

export function HumanReadablePayload({
  payload,
  title = 'Request information',
}: {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly title?: string;
}): React.JSX.Element {
  const entries = Object.entries(payload);
  return (
    <section aria-labelledby="human-payload-title" className="qf-payload-summary">
      <div className="qf-payload-summary__header">
        <div>
          <p className="qf-eyebrow">Submitted details</p>
          <h3 id="human-payload-title">{title}</h3>
        </div>
        <span>
          {String(entries.length)} field{entries.length === 1 ? '' : 's'}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="qf-utility">No additional information was submitted.</p>
      ) : (
        <dl className="qf-readable-fields">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{workflowFieldLabel(key)}</dt>
              <dd>{displayValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
