/** A record with one entry for each item, under the key `keyOf` gives it. Its key type is `keyOf`'s return type, so
 * `items` must be the catalog that type is drawn from (`agentTypes`, `workflows`), not a selection from it: each of
 * the catalog's keys then holds an entry. Two items under one key would lose one of them, so they throw. */
export function recordOf<T, K extends PropertyKey, V>(
  items: readonly T[],
  keyOf: (item: T) => K,
  valueOf: (item: T) => V,
): Record<K, V> {
  const record: Partial<Record<K, V>> = {};
  const keys = items.map(keyOf);
  items.forEach((item, index) => {
    const key = keys[index];
    if (Object.hasOwn(record, key)) throw new Error(`A catalog holds two entries under ${String(key)}`);
    record[key] = valueOf(item);
  });
  if (!holdsEvery(record, keys)) throw new Error('A record built from a catalog is missing an entry');
  return record;
}

/** Whether `record` holds an entry under each of `keys`. TypeScript cannot follow a loop that fills every key of `K`,
 * so this check carries the step from a partial record to a full one; `keys` covering `K` is `recordOf`'s contract
 * with its caller. */
function holdsEvery<K extends PropertyKey, V>(
  record: Partial<Record<K, V>>,
  keys: readonly K[],
): record is Record<K, V> {
  return keys.every(key => Object.hasOwn(record, key));
}
