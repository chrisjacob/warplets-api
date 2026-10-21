import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { cpSync, renameSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { build: buildWorker } = createRequire(require.resolve('vite/package.json'))('esbuild');
const output = resolve(import.meta.dirname, '../.tmp/network-dist');
export default defineConfig({ root: import.meta.dirname, publicDir: false, plugins: [react(), { name: 'network-preview-assets', async closeBundle() { renameSync(resolve(output, 'network.html'), resolve(output, 'index.html')); cpSync(resolve(import.meta.dirname, 'public/network'), resolve(output, 'network'), { recursive: true }); await buildWorker({entryPoints:[resolve(import.meta.dirname,'../scripts/network/preview-worker.ts')],outfile:resolve(output,'_worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'}); } }], build: { outDir: output, emptyOutDir: true, rollupOptions: { input: resolve(import.meta.dirname, 'network.html') } } });
