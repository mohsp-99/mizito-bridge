import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  clean: true,
  // The core and the MCP SDK stay external — they resolve at runtime.
  external: ['@mohsp-99/mizito-core', '@modelcontextprotocol/sdk', 'zod'],
});
