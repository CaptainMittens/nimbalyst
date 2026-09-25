// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildJevRequest,
  callJev,
  interpretJevResponse,
  type JevResponse,
  type SortContext,
} from '../src/curator/jevSorter';

const ctx: SortContext = {
  areas: [{ id: 'area-product', title: 'Product' }],
  candidates: [
    { id: 'claim-1', kind: 'claim', title: 'Sync uses PGLite', statement: 'Desktop sync stores state in PGLite' },
    { id: 'ent-1', kind: 'entity', title: 'Desktop app' },
  ],
};

function answers(knowledge: number, area: [string, number], target: [string, number], contradicts?: number): JevResponse {
  return {
    model: 'jev-1.13.0',
    answers: {
      knowledge: { type: 'noul', noul: knowledge },
      area: { type: 'choice', choice: area[0], probabilities: {}, confidence: area[1] },
      target: { type: 'choice', choice: target[0], probabilities: {}, confidence: target[1] },
      ...(contradicts === undefined ? {} : { 'contradicts:claim-1': { type: 'noul' as const, noul: contradicts } }),
    },
  };
}

describe('Jev sorter', () => {
  it('asks a contradiction check only for claim candidates, and gates every step on confidence', () => {
    const req = buildJevRequest({ ref: 'abc123', kind: 'commit', title: 'Move sync to SQLite', text: 'x' }, ctx);
    expect(Object.keys(req.questions).sort()).toEqual(['area', 'contradicts:claim-1', 'knowledge', 'target']);
    expect(Object.keys((req.questions.target as { criteria: object }).criteria)).toEqual(['claim-1', 'ent-1', 'new']);

    const verdict = (r: JevResponse) => {
      const d = interpretJevResponse(r, ctx);
      return d.verdict === 'drop' ? `drop:${d.reason}` : d.verdict;
    };
    expect(verdict(answers(0.2, ['area-product', 0.9], ['new', 0.9]))).toBe('drop:not-knowledge');
    expect(verdict(answers(0.7, ['area-product', 0.9], ['new', 0.9]))).toBe('drop:uncertain-knowledge');
    expect(verdict(answers(0.9, ['none', 0.9], ['new', 0.9]))).toBe('drop:no-area');
    expect(verdict(answers(0.9, ['area-product', 0.4], ['new', 0.9]))).toBe('drop:uncertain-area');
    // A shaky "new" is dropped, not created: that is how duplicates get in.
    expect(verdict(answers(0.9, ['area-product', 0.9], ['new', 0.5]))).toBe('drop:uncertain-target');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['new', 0.9]))).toBe('create');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['ent-1', 0.9]))).toBe('update');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['claim-1', 0.9], 0.5))).toBe('update');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['claim-1', 0.9], 0.95))).toBe('supersede');
  });

  it('retries 429/529 honoring retry-after, and fails fast on other errors', async () => {
    const reply = (status: number, body: unknown, retryAfter?: string) => ({
      ok: status === 200,
      status,
      headers: { get: (h: string) => (h === 'retry-after' ? retryAfter ?? null : null) },
      text: async () => JSON.stringify(body),
    });
    const waits: number[] = [];
    const queue = [reply(429, {}, '2'), reply(529, {}), reply(200, answers(0.9, ['area-product', 0.9], ['new', 0.9]))];
    const res = await callJev(buildJevRequest({ ref: 'r', kind: 'commit', title: 't', text: 'x' }, ctx), {
      apiKey: 'k',
      fetch: async () => queue.shift()!,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(res.answers.knowledge).toEqual({ type: 'noul', noul: 0.9 });
    expect(waits).toEqual([2000, 1000]);

    await expect(
      callJev(buildJevRequest({ ref: 'r', kind: 'commit', title: 't', text: 'x' }, ctx), {
        apiKey: 'bad',
        fetch: async () => reply(401, { detail: 'no key' }),
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ status: 401 });
  });
});
