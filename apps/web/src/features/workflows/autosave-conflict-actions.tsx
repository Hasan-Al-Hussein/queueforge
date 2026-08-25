import { Button } from '@queueforge/ui';

export function AutosaveConflictActions({
  disabled = false,
  onKeepLocal,
  onLoadServer,
}: {
  readonly disabled?: boolean;
  readonly onKeepLocal: () => void;
  readonly onLoadServer: () => void;
}): React.JSX.Element {
  return (
    <>
      <Button disabled={disabled} onClick={onLoadServer}>
        Use saved copy
      </Button>
      <Button disabled={disabled} onClick={onKeepLocal} tone="primary">
        Keep my changes
      </Button>
    </>
  );
}
