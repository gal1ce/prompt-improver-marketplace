import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../hooks/register.js';

function createHarness({ forkResponses = [], completeResponses = [], root = '' } = {}) {
  let handler;
  const logs = [];
  const calls = { fork: [], complete: [] };
  register((event, fn) => {
    if (event === 'prompt.submit') handler = fn;
    return { catch() {} };
  });

  const $ = {
    session: {
      root: async () => root,
      messages: async () => [],
      model: async () => 'test-model',
    },
    fs: {
      list: async () => [],
      exists: async () => false,
      read: async () => '',
    },
    model: {
      fork: async (input) => {
        calls.fork.push(input);
        const next = forkResponses.shift();
        if (next instanceof Error) throw next;
        return next ?? null;
      },
      complete: async (input) => {
        calls.complete.push(input);
        const next = completeResponses.shift();
        if (next instanceof Error) throw next;
        return next ?? null;
      },
    },
    ui: { log: (message) => logs.push(message) },
  };

  return {
    $, calls, logs,
    async submit(text) {
      assert.equal(typeof handler, 'function', 'prompt.submit handler registered');
      let forwarded;
      const result = await handler($, { text }, async (event) => {
        forwarded = event;
        return event;
      });
      return { forwarded, result };
    },
  };
}

test('unmarked prompt passes through without model calls', async () => {
  const h = createHarness();
  const { forwarded } = await h.submit('Explain the auth flow.');
  assert.equal(forwarded.text, 'Explain the auth flow.');
  assert.equal(h.calls.fork.length + h.calls.complete.length, 0);
});

test('marked prompt sends an accepted rewrite after reviewer approval', async () => {
  const draft = 'Explain the authentication flow without changing code.';
  const h = createHarness({ forkResponses: [
    { text: draft },
    { text: JSON.stringify({ decision: 'accept', text: draft }) },
  ] });
  const { forwarded } = await h.submit('Explain auth. --improve');
  assert.equal(forwarded.text, draft);
  assert.equal(h.calls.fork.length, 2);
  assert.match(h.logs.at(-1), /Reviewer accepted the draft/);
});

test('reviewer repair replaces the draft and removes a returned marker', async () => {
  const h = createHarness({ forkResponses: [
    { text: 'Investigate and refactor authentication.' },
    { text: JSON.stringify({ decision: 'repair', text: 'Investigate authentication only. --improve' }) },
  ] });
  const { forwarded } = await h.submit('Investigate authentication. --improve');
  assert.equal(forwarded.text, 'Investigate authentication only.');
  assert.match(h.logs.at(-1), /Reviewer corrected the draft/);
});

test('reviewer outage keeps the usable rewrite and reports the fallback', async () => {
  const h = createHarness({
    forkResponses: [{ text: 'Clearer request.' }, new Error('review fork unavailable')],
    completeResponses: [new Error('review fallback unavailable')],
  });
  const { forwarded } = await h.submit('Request. --improve');
  assert.equal(forwarded.text, 'Clearer request.');
  assert.match(h.logs.at(-1), /Reviewer unavailable/);
});

test('cold rewrite fork uses complete, then reviewer uses fork', async () => {
  const draft = 'Review the login flow and cite relevant files.';
  const h = createHarness({
    forkResponses: [null, { text: JSON.stringify({ decision: 'accept', text: draft }) }],
    completeResponses: [draft],
  });
  const { forwarded } = await h.submit('Review login. --improve');
  assert.equal(forwarded.text, draft);
  assert.equal(h.calls.complete.length, 1);
  assert.equal(h.calls.complete[0].model, 'test-model');
});

test('empty marked prompt is dropped before model calls', async () => {
  const h = createHarness();
  const { result, forwarded } = await h.submit(' --improve');
  assert.deepEqual(result, { drop: 'Write the request before --improve.' });
  assert.equal(forwarded, undefined);
  assert.equal(h.calls.fork.length + h.calls.complete.length, 0);
});
