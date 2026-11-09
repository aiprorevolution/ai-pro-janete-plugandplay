import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { nitro } from 'nitro/vite';

export default defineConfig(({ command }) => ({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: 'server' } }),
    react(),
    ...(command === 'build' ? [nitro({ preset: 'node_server' })] : []),
  ],
  // O AI Studio acessa a prévia por 0.0.0.0:3000 (ele mesmo acrescenta --host/--port ao npm run dev; isto é a rede de segurança).
  server: { host: process.env['HOST'] || '0.0.0.0', port: Number(process.env['PORT'] || 3000) },
}));
