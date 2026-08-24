import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DirtyNavigationProvider,
  useDirtyNavigation,
  useDirtyNavigationSource,
} from './dirty-navigation-provider';

const dialogPrototype = HTMLDialogElement.prototype;
const originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, 'close');

function restoreDialogMethod(
  name: 'close' | 'showModal',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(dialogPrototype, name);
    return;
  }
  Object.defineProperty(dialogPrototype, name, descriptor);
}

beforeAll(() => {
  Object.defineProperty(dialogPrototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(dialogPrototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement): void {
      this.removeAttribute('open');
    },
  });
});

afterAll(() => {
  restoreDialogMethod('showModal', originalShowModal);
  restoreDialogMethod('close', originalClose);
});

function Harness({ action }: { readonly action: () => void }): React.JSX.Element {
  const [dirty, setDirty] = useState(true);
  const { requestExit } = useDirtyNavigation();
  useDirtyNavigationSource(dirty);
  return (
    <>
      <button onClick={() => requestExit(action)} type="button">
        Leave surface
      </button>
      <button onClick={() => setDirty(false)} type="button">
        Mark persisted
      </button>
    </>
  );
}

describe('DirtyNavigationProvider', () => {
  it('blocks a dirty exit until the operator explicitly confirms', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <DirtyNavigationProvider>
        <Harness action={action} />
      </DirtyNavigationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Leave surface' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Continue with unsaved changes?' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(action).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Leave surface' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('stops prompting only after the dirty source reports a persisted state', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <DirtyNavigationProvider>
        <Harness action={action} />
      </DirtyNavigationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Mark persisted' }));
    await user.click(screen.getByRole('button', { name: 'Leave surface' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('dialog', { name: 'Continue with unsaved changes?' }),
    ).not.toBeInTheDocument();
  });

  it('guards browser Back and Forward traversal while a source is dirty', async () => {
    const user = userEvent.setup();
    render(
      <DirtyNavigationProvider>
        <Harness action={vi.fn()} />
      </DirtyNavigationProvider>,
    );
    window.history.replaceState(window.history.state, '', '/workflows');
    window.history.pushState({}, '', '/workflows/editor?id=draft');

    act(() => window.history.back());
    expect(
      await screen.findByRole('dialog', { name: 'Continue with unsaved changes?' }),
    ).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe('/workflows/editor'));

    await user.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    await waitFor(() => expect(window.location.pathname).toBe('/workflows'));

    act(() => window.history.forward());
    expect(
      await screen.findByRole('dialog', { name: 'Continue with unsaved changes?' }),
    ).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe('/workflows'));

    await user.click(screen.getByRole('button', { name: 'Discard changes and continue' }));
    await waitFor(() => expect(window.location.pathname).toBe('/workflows/editor'));
  });
});
