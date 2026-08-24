import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  stories: ['../src/**/*.stories.@(ts|tsx)', '../../../packages/ui/src/**/*.stories.@(ts|tsx)'],
};

export default config;
