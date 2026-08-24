const base = require('../../jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  collectCoverage: false,
  rootDir: '../..',
  setupFilesAfterEnv: ['<rootDir>/tests/integration/setup.ts'],
  testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
  testTimeout: 30_000,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        diagnostics: true,
        tsconfig: {
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          module: 'CommonJS',
          target: 'ES2023',
          useDefineForClassFields: false,
        },
      },
    ],
  },
};
