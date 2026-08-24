import type { Preview } from '@storybook/nextjs-vite';

import '../app/globals.css';

const preview: Preview = {
  decorators: [
    (Story): React.JSX.Element => (
      <div style={{ margin: '24px', maxWidth: '960px' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    a11y: { test: 'error' },
    controls: { expanded: true },
    layout: 'fullscreen',
  },
};

export default preview;
