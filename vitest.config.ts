import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // node-pty is rebuilt against the Electron ABI (SPEC 13 R5), so it cannot be
    // loaded by the plain Node process that runs vitest.
    exclude: ['**/node_modules/**', 'out/**', 'dist/**']
  }
})
