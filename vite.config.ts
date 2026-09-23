import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // GitHub Pages はリポジトリ名のサブパスで配信されるため、本番ビルドのみ base を合わせる
  base: process.env.GITHUB_PAGES === 'true' ? '/dq3-monster-arena-simulator/' : '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
