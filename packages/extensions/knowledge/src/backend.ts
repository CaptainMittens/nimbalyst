/**
 * Knowledge extension backend module (Electron utility process).
 *
 * Hosts the curator's Jev sorter. It lives here rather than in the renderer
 * because api.typesafe.ai rejects the app's origin under CORS.
 *
 * The TypeSafe key comes only from the `getApiKey('typesafe')` broker, which
 * reads the encrypted credential the settings panel saved. Never `process.env`.
 *
 * Method names below must match the names passed to registerMcpTools; the host
 * advertises them as `knowledge.<name>`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_THRESHOLDS,
  JevError,
  sortEvent,
  type CuratorArea,
  type CuratorCandidate,
  type CuratorEvent,
  type SortResult,
  type SortThresholds,
} from './curator/jevSorter';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ActivateCtx {
  services: {
    dataDir: string;
    log: (level: LogLevel, message: string, data?: unknown) => void;
    getApiKey: (providerId: string) => Promise<{ key: string | null }>;
    registerMcpTools: (
      tools: Array<{ name: string; description?: string; inputSchema?: unknown; scope?: 'global' | 'editor' }>
    ) => Promise<{ registered: string[] }>;
  };
}

export const TYPESAFE_CREDENTIAL = 'typesafe';
/** USD per input token for jev-1.13 ($0.042 per million). Output is free. */
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const CONCURRENCY = 4;

type SortEventInput = CuratorEvent & { candidates?: CuratorCandidate[] };

const TOOLS = [
  {
    name: 'sort_events',
    description:
      'Knowledge curator sorter. For each work event (commit, session, tracker change), asks the Jev decision model whether it carries durable knowledge, which wiki area it belongs to, and which existing item it is about (or "new"), and whether it contradicts that claim. Returns a verdict per event: create, update, supersede, or drop with a reason. Only confident answers pass. Requires a TypeSafe API key in Settings > Knowledge curator. Every decision is logged locally for evaluation.',
    inputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          description: 'Events to sort. Keep text to the relevant part; long state lowers accuracy.',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Commit SHA, session id, or tracker key' },
              kind: { type: 'string', enum: ['commit', 'session', 'tracker-change'] },
              title: { type: 'string' },
              text: { type: 'string' },
              paths: { type: 'array', items: { type: 'string' } },
              candidates: {
                type: 'array',
                description: 'Existing wiki items this event might be about (retrieved by search), at most ~20.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    kind: { type: 'string', enum: ['entity', 'claim', 'question', 'finding'] },
                    title: { type: 'string' },
                    statement: { type: 'string' },
                  },
                  required: ['id', 'kind', 'title'],
                },
              },
            },
            required: ['ref', 'kind', 'title', 'text'],
          },
        },
        areas: {
          type: 'array',
          description: 'Wiki areas (entities with kind: area).',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
            required: ['id', 'title'],
          },
        },
        guidance: { type: 'string', description: "What belongs in this wiki, from the project's wiki guide." },
        thresholds: {
          type: 'object',
          description: 'Override gates (0-1): knowledge, area, target, contradiction.',
          properties: {
            knowledge: { type: 'number' },
            area: { type: 'number' },
            target: { type: 'number' },
            contradiction: { type: 'number' },
          },
        },
      },
      required: ['events', 'areas'],
    },
  },
  {
    name: 'curator_status',
    description: 'Whether a TypeSafe key is configured, and how many sorter decisions have been logged.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function activate(ctx: ActivateCtx) {
  const { dataDir, log, getApiKey, registerMcpTools } = ctx.services;
  mkdirSync(dataDir, { recursive: true });
  const decisionLog = path.join(dataDir, 'curator-decisions.jsonl');

  // Read per call, not at activation, so a key saved after startup is picked up.
  async function readKey(): Promise<string | null> {
    try {
      return (await getApiKey(TYPESAFE_CREDENTIAL)).key;
    } catch {
      return null;
    }
  }

  await registerMcpTools(TOOLS.map((t) => ({ ...t, scope: 'global' as const })));

  return {
    methods: {
      sort_events: async (params: {
        events?: SortEventInput[];
        areas?: CuratorArea[];
        guidance?: string;
        thresholds?: Partial<SortThresholds>;
      }) => {
        const events = Array.isArray(params?.events) ? params.events : [];
        const areas = Array.isArray(params?.areas) ? params.areas : [];
        if (!events.length) throw new Error('events is required');
        if (!areas.length) throw new Error('areas is required: list the wiki area entities');
        const apiKey = await readKey();
        if (!apiKey) {
          throw new Error('No TypeSafe API key. Add one in Settings > Knowledge curator.');
        }
        const thresholds = { ...DEFAULT_THRESHOLDS, ...(params.thresholds ?? {}) };

        const auth: { failure: JevError | null } = { failure: null };
        const results = await mapLimit(events, CONCURRENCY, async (event) => {
          if (auth.failure) return { ref: event.ref, error: 'skipped after authentication failure' };
          try {
            return await sortEvent(
              event,
              { areas, candidates: event.candidates ?? [], guidance: params.guidance },
              { apiKey, fetch, thresholds }
            );
          } catch (err) {
            if (err instanceof JevError && (err.status === 401 || err.status === 403)) auth.failure = err;
            return { ref: event.ref, error: (err as Error).message };
          }
        });
        if (auth.failure) throw auth.failure;

        const sorted = results.filter((r): r is SortResult => 'decision' in r);
        const at = new Date().toISOString();
        const lines = sorted.map((r) => {
          const event = events.find((e) => e.ref === r.ref);
          return JSON.stringify({ at, ref: r.ref, kind: event?.kind, title: event?.title, model: r.model, thresholds, decision: r.decision });
        });
        if (lines.length) appendFileSync(decisionLog, lines.join('\n') + '\n');

        const inputTokens = sorted.reduce((n, r) => n + r.inputTokens, 0);
        const dropped: Record<string, number> = {};
        for (const r of sorted) {
          if (r.decision.verdict === 'drop') dropped[r.decision.reason] = (dropped[r.decision.reason] ?? 0) + 1;
        }
        log('info', `[knowledge] sorted ${sorted.length}/${events.length} event(s), ${inputTokens} input tokens`);
        return {
          results,
          summary: {
            sorted: sorted.length,
            errors: results.length - sorted.length,
            passed: sorted.filter((r) => r.decision.verdict !== 'drop').length,
            dropped,
            inputTokens,
            costUsd: Number((inputTokens * JEV_USD_PER_INPUT_TOKEN).toFixed(6)),
            thresholds,
          },
        };
      },

      curator_status: async () => {
        const logged = existsSync(decisionLog)
          ? readFileSync(decisionLog, 'utf-8').split('\n').filter(Boolean).length
          : 0;
        return { keyConfigured: Boolean(await readKey()), decisionsLogged: logged, decisionLog };
      },
    },
  };
}
