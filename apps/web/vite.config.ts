import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import oxlintPlugin from 'vite-plugin-oxlint';

export default defineConfig({
  plugins: [oxlintPlugin(), react()],
});
