/** The Node binary that tests launch helper processes with. `npm test` sets `VIBEBRIDGE_TEST_NODE`; a run without it
 * fails as soon as a test loads this module. */
function readTestNode() {
  const path = process.env.VIBEBRIDGE_TEST_NODE;
  if (!path) throw new Error('VIBEBRIDGE_TEST_NODE is not set. Run the tests through `npm test`, which sets it.');
  return path;
}

export const testNode = readTestNode();
