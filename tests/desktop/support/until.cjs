const { inspect } = require('node:util');

const describe = context => {
  let timer;
  const limit = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('no answer within 2000 ms')), 2000);
  });
  return Promise.race([Promise.resolve().then(context), limit]).finally(() => clearTimeout(timer));
};

module.exports = async function until(check, label, { timeout = 10000, context } = {}) {
  if (typeof label !== 'string' || !label.trim())
    throw new TypeError('A desktop wait needs a label naming the awaited behaviour.');
  const deadline = Date.now() + timeout;
  let last;
  while (!(last = await check())) {
    if (Date.now() > deadline) {
      const value = inspect(last, { breakLength: Infinity });
      let message = `Timed out waiting for: ${label} (last: ${value.length > 200 ? `${value.slice(0, 200)}…` : value})`;
      if (context) message += `\n${await describe(context).catch(error => `context unavailable: ${error.message}`)}`;
      throw new Error(message);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
};
