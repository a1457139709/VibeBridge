import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { act, cleanup, render } from '@testing-library/react';
import { useRequestResult } from '../../app/renderer/common/request-result';
import { deferred } from './support/workbench';

afterEach(cleanup);

function renderRequests(keys: readonly string[]) {
  const requests = new Map(keys.map(key => [key, deferred<string>()]));
  const results: (string | undefined)[] = [];
  function Harness({ requestKey }: { requestKey: string | undefined }) {
    const result = useRequestResult(requestKey, key => requests.get(key)?.promise ?? Promise.reject(new Error(key)));
    results.push(result);
    return null;
  }
  const view = render(<Harness requestKey={keys[0]} />);
  return {
    show: (requestKey: string | undefined) => view.rerender(<Harness requestKey={requestKey} />),
    settle: (key: string, result: string) => act(async () => requests.get(key)?.resolve(result)),
    shown: () => results.at(-1),
  };
}

test('a request result shows once its request settles', async () => {
  const requests = renderRequests(['A']);
  assert.equal(requests.shown(), undefined);
  await requests.settle('A', 'result A');
  assert.equal(requests.shown(), 'result A');
});

test("after the key changes, the earlier key's result is no longer shown", async () => {
  const requests = renderRequests(['A', 'B']);
  await requests.settle('A', 'result A');
  requests.show('B');
  assert.equal(requests.shown(), undefined);
  await requests.settle('B', 'result B');
  assert.equal(requests.shown(), 'result B');
});

test('a request that settles after its key changed is dropped', async () => {
  const requests = renderRequests(['A', 'B']);
  requests.show('B');
  await requests.settle('A', 'result A');
  assert.equal(requests.shown(), undefined);
  requests.show(undefined);
  await requests.settle('B', 'result B');
  assert.equal(requests.shown(), undefined);
});

test('a failed request is recovered into a result only while its key is current', async () => {
  const requests = new Map(['A', 'B'].map(key => [key, deferred<string>()]));
  const recovered: unknown[] = [];
  const results: (string | undefined)[] = [];
  function Harness({ requestKey }: { requestKey: string }) {
    const result = useRequestResult(requestKey, key => requests.get(key)?.promise ?? Promise.reject(new Error(key)), {
      recover: error => {
        recovered.push(error);
        return 'recovered';
      },
    });
    results.push(result);
    return null;
  }
  const view = render(<Harness requestKey="A" />);
  view.rerender(<Harness requestKey="B" />);
  const failure = new Error('failed');
  await act(async () => requests.get('A')?.reject(failure));
  assert.deepEqual(recovered, []);
  assert.equal(results.at(-1), undefined);
  await act(async () => requests.get('B')?.reject(failure));
  assert.deepEqual(recovered, [failure]);
  assert.equal(results.at(-1), 'recovered');
});
