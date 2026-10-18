import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { cpSync, renameSync } from 'node:fs';
const output = resolve(import.meta.dirname, '../.tmp/network-dist');
export default defineConfig({ root: import.meta.dirname, publicDir: false, plugins: [react(), { name: 'network-preview-assets', closeBundle() { renameSync(resolve(output, 'network.html'), resolve(output, 'index.html')); cpSync(resolve(import.meta.dirname, 'public/network'), resolve(output, 'network'), { recursive: true }); } }], build: { outDir: output, emptyOutDir: true, rollupOptions: { input: resolve(import.meta.dirname, 'network.html') } } });
