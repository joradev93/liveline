import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  clean: true,
  // Workspace packages export TypeScript source, so bundle them (and their deps) into the app.
  noExternal: [/^@liveline\//, 'zod'],
  external: ['uWebSockets.js'],
});
