import { describe, expect, it } from 'vitest';

import {
  draftFromForm,
  draftProblemField,
  shouldScheduleAutosave,
  type EditorForm,
} from './workflow-editor-screen';

const baseForm: EditorForm = {
  description: 'Routes an approved expense.',
  isEnabled: true,
  name: 'Expense review',
  preventSelfApproval: true,
  processingConfigText: '{"maxAttempts":5}',
  requestSchemaText: '{"type":"object"}',
  requiresApproval: true,
  targetsText:
    '[{"targetKind":"processor","position":0,"config":{"handler":"demo"}},{"targetKind":"webhook","position":1,"config":{"endpointId":"30000000-0000-4000-8000-000000000001"}}]',
};

describe('workflow editor draft policy', () => {
  it('preserves enabled state and ordered targets in autosave input', () => {
    const result = draftFromForm(baseForm, 7);
    expect(result.input).toMatchObject({
      expectedRevision: 7,
      isEnabled: true,
      targets: [
        { position: 0, targetKind: 'processor' },
        { position: 1, targetKind: 'webhook' },
      ],
    });
  });

  it('reports duplicate target positions at the target editor', () => {
    const result = draftFromForm(
      {
        ...baseForm,
        targetsText:
          '[{"targetKind":"processor","position":0,"config":{}},{"targetKind":"notification","position":0,"config":{}}]',
      },
      7,
    );
    expect(result.input).toBeUndefined();
    expect(result.problem?.field).toBe('targetsText');
  });

  it('routes contract issues to the control that produced them', () => {
    expect(draftFromForm({ ...baseForm, name: '' }, 7).problem?.field).toBe('name');
    expect(draftFromForm({ ...baseForm, description: 'a'.repeat(2001) }, 7).problem?.field).toBe(
      'description',
    );
    expect(draftProblemField(['requiresApproval'])).toBe('requiresApproval');
    expect(draftProblemField(['preventSelfApproval'])).toBe('preventSelfApproval');
    expect(draftProblemField(['isEnabled'])).toBe('isEnabled');
    expect(draftProblemField(['expectedRevision'])).toBe('root');
  });

  it('does not loop after a failed save but resumes after the form changes', () => {
    expect(
      shouldScheduleAutosave({
        editable: true,
        lastAttemptedSignature: 'draft-a',
        lastSavedSignature: 'server-copy',
        online: true,
        saveState: 'error',
        signature: 'draft-a',
      }),
    ).toBe(false);
    expect(
      shouldScheduleAutosave({
        editable: true,
        lastAttemptedSignature: 'draft-a',
        lastSavedSignature: 'server-copy',
        online: true,
        saveState: 'error',
        signature: 'draft-b',
      }),
    ).toBe(true);
  });
});
