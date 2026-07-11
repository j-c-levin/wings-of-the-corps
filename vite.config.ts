/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built app works when served from a sub-path
  // (GitHub Pages project sites) as well as from a domain root.
  base: './',
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
