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
  assert.ok(h.logs.some((l) => /Reviewer accepted the draft/.test(l)));
  assert.equal(h.logs.at(-1), `[prompt sent to the model]\n${draft}`);
});

test('reviewer repair replaces the draft and removes a returned marker', async () => {
  const h = createHarness({ forkResponses: [
    { text: 'Investigate and refactor authentication.' },
    { text: JSON.stringify({ decision: 'repair', text: 'Investigate authentication only. --improve' }) },
  ] });
  const { forwarded } = await h.submit('Investigate authentication. --improve');
  assert.equal(forwarded.text, 'Investigate authentication only.');
  assert.ok(h.logs.some((l) => /Reviewer corrected the draft/.test(l)));
});

test('reviewer outage keeps the usable rewrite and reports the fallback', async () => {
  const h = createHarness({
    forkResponses: [{ text: 'Clearer request.' }, new Error('review fork unavailable')],
    completeResponses: [new Error('review fallback unavailable')],
  });
  const { forwarded } = await h.submit('Request. --improve');
  assert.equal(forwarded.text, 'Clearer request.');
  assert.ok(h.logs.some((l) => /Reviewer unavailable/.test(l)));
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

test('rewrite instructions require an English prompt scaled to task difficulty', async () => {
  const draft = 'Re-verify the results from raw data.';
  const h = createHarness({ forkResponses: [
    { text: draft },
    { text: JSON.stringify({ decision: 'accept', text: draft }) },
  ] });
  await h.submit('Sonuçlara güvenmiyorum, detaylı analiz yap. --improve');
  assert.match(h.calls.fork[0].prompt, /Always write the rewritten prompt in English/);
  assert.match(h.calls.fork[0].prompt, /Hard or open-ended/);
  assert.match(h.calls.fork[1].prompt, /must be in English/);
});

test('long final prompt is logged in full across several lines', async () => {
  const draft = 'x'.repeat(4500);
  const h = createHarness({ forkResponses: [
    { text: draft },
    { text: JSON.stringify({ decision: 'accept', text: draft }) },
  ] });
  await h.submit('Do it. --improve');
  const parts = h.logs.filter((l) => l.startsWith('[prompt sent to the model'));
  assert.equal(parts.length, 3);
  assert.equal(parts.map((l) => l.slice(l.indexOf('\n') + 1)).join(''), draft);
});

test('--max-tokens after --improve overrides the reply cap and is stripped', async () => {
  const draft = 'Clear request.';
  const h = createHarness({
    forkResponses: [null, null],
    completeResponses: [draft, JSON.stringify({ decision: 'accept', text: draft })],
  });
  const { forwarded } = await h.submit('Request. --improve --max-tokens 40000');
  assert.equal(forwarded.text, draft);
  assert.match(h.calls.complete[0].prompt, /"Request\."/);
  assert.deepEqual(h.calls.complete.map((c) => c.maxTokens), [40000, 40000]);
});

test('reply cap defaults to 24000 and is clamped to 64000', async () => {
  const draft = 'Clear request.';
  for (const [suffix, expected] of [['--improve', 24000], ['--improve --max-tokens=999999', 64000]]) {
    const h = createHarness({ forkResponses: [null], completeResponses: [draft] });
    await h.submit(`Request. ${suffix}`);
    assert.equal(h.calls.complete[0].maxTokens, expected);
  }
});
