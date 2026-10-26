import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'app/main/electron.ts',
    preload: 'app/main/preload.ts',
    terminal: 'app/terminal/host.ts',
    storage: 'app/main/storage-worker.ts',
    'codex-reporter': 'app/main/agent-status/codex/reporter.ts',
    'claude-reporter': 'app/main/agent-status/claude/reporter.ts',
  },
  outdir: 'dist', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron', 'node-pty'], sourcemap: true,
});

await build({ entryPoints: { 'pi-reporter': 'app/main/agent-status/pi/reporter.ts' }, outdir: 'dist', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true });
