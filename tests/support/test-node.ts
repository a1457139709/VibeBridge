function readTestNode() {
  const path = process.env.VIBEBRIDGE_TEST_NODE;
  if (!path) throw new Error('VIBEBRIDGE_TEST_NODE is not set. Run the tests through `npm test`, which sets it.');
  return path;
}

export const testNode = readTestNode();
