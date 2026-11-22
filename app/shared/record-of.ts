/** A record with one entry for each item, under the key `keyOf` gives it. Its key type is `keyOf`'s return type, so
 * `items` names every one of those keys: a catalog (`agentTypes`, `workflows`) rather than a selection from it. */
export function recordOf<T, K extends PropertyKey, V>(
  items: readonly T[],
  keyOf: (item: T) => K,
  valueOf: (item: T) => V,
): Record<K, V> {
  const record: Partial<Record<K, V>> = {};
  for (const item of items) record[keyOf(item)] = valueOf(item);
  if (!holdsEvery(record, items.map(keyOf))) throw new Error('A record built from a catalog is missing an entry');
  return record;
}

function holdsEvery<K extends PropertyKey, V>(
  record: Partial<Record<K, V>>,
  keys: readonly K[],
): record is Record<K, V> {
  return keys.every(key => key in record);
}
