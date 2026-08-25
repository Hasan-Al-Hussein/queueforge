import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkflowFieldBuilder } from './workflow-field-builder';

function BuilderHarness(): React.JSX.Element {
  const [json, setJson] = useState(
    JSON.stringify({ type: 'object', additionalProperties: false, properties: {} }, null, 2),
  );
  return <WorkflowFieldBuilder disabled={false} jsonText={json} onChange={setJson} />;
}

describe('WorkflowFieldBuilder', () => {
  it('creates a request field visually and keeps advanced JSON synchronized', async () => {
    const user = userEvent.setup();
    render(<BuilderHarness />);

    await user.click(screen.getByRole('button', { name: 'Add field' }));
    const label = screen.getByLabelText('Question label');
    await user.clear(label);
    await user.type(label, 'Purchase reason');
    await user.click(screen.getByRole('button', { name: 'Advanced JSON' }));

    const schema = screen.getByRole('textbox', { name: 'Request schema' });
    expect(schema).toHaveValue();
    expect((schema as HTMLTextAreaElement).value).toContain('Purchase reason');
    expect((schema as HTMLTextAreaElement).value).toContain('field_1');
  });
});
