const { buildSync } = require('esbuild');
const { resolve } = require('node:path');
const { runInThisContext } = require('node:vm');

const [bundle] = buildSync({
  entryPoints: [resolve(__dirname, '../../../app/shared/localization/localization.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles;
const compiled = { exports: {} };
runInThisContext(`(function (module, exports, require) {${bundle.text}\n})`)(compiled, compiled.exports, require);
const { localize } = compiled.exports;

const named = (selector, name) => JSON.stringify(`${selector}[aria-label=${JSON.stringify(name)}]`);
module.exports = { localize, t: localize('en').t, named };
