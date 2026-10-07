import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'app/main/electron.ts',
    preload: 'app/main/preload.ts',
    terminal: 'app/terminal/host.ts',
    storage: 'app/main/storage-worker.ts',
  },
  outdir: 'dist', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron', 'node-pty'], sourcemap: true,
});
