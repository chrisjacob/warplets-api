import { defineConfig } from 'vitest/config';
export default defineConfig({ root: import.meta.dirname, test: { include: ['functions/_lib/network/*.test.ts'], maxWorkers: 1, fileParallelism: false } });
