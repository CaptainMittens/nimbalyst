/**
 * Knowledge curator settings: the TypeSafe API key the Jev sorter uses.
 *
 * The key is saved to the host's encrypted provider credential store under the
 * `typesafe` name, which is the only place the backend's `getApiKey` broker
 * reads from.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SettingsPanelProps } from '@nimbalyst/runtime';

const CREDENTIAL = 'typesafe';

interface CuratorStatus {
  keyConfigured?: boolean;
  decisionsLogged?: number;
  decisionLog?: string;
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return (window as unknown as { electronAPI: { invoke(c: string, ...a: unknown[]): Promise<unknown> } }).electronAPI.invoke(
    channel,
    ...args
  );
}

export function KnowledgeCuratorSettings({ callBackendTool }: SettingsPanelProps) {
  const [status, setStatus] = useState<CuratorStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!callBackendTool) return;
    try {
      setStatus((await callBackendTool('knowledge.curator_status')) as CuratorStatus);
      setError(null);
    } catch (err) {
      setError(`The knowledge backend is not running: ${(err as Error).message}`);
    }
  }, [callBackendTool]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (value: string) => {
    setSaving(true);
    try {
      if (value) await invoke('provider-credentials:set', CREDENTIAL, value);
      else await invoke('provider-credentials:delete', CREDENTIAL);
      setDraft('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="knowledge-curator-settings" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4, fontSize: 13 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          TypeSafe API key
          <span className="knowledge-curator-alpha-badge" style={ALPHA_BADGE}>
            Alpha
          </span>
        </h3>
        <p className="select-text" style={{ margin: 0, color: 'var(--nim-text-muted)' }}>
          The curator sends each commit, session summary, and tracker change it sorts to TypeSafe (api.typesafe.ai) to decide whether it belongs in the knowledge graph. Nothing is sent until a key is saved here.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="password"
            className="knowledge-curator-key-input"
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid var(--nim-border)',
              background: 'var(--nim-bg-secondary)',
              color: 'var(--nim-text)',
            }}
            placeholder={status?.keyConfigured ? 'Saved. Enter a new key to replace it.' : 'TypeSafe API key'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="button" className="knowledge-curator-key-save" style={BUTTON_PRIMARY} disabled={!draft.trim() || saving} onClick={() => void save(draft.trim())}>
            Save
          </button>
          {status?.keyConfigured ? (
            <button type="button" className="knowledge-curator-key-remove" style={BUTTON} disabled={saving} onClick={() => void save('')}>
              Remove
            </button>
          ) : null}
        </div>
      </section>
      <section className="select-text" style={{ color: 'var(--nim-text-muted)' }}>
        {status ? (
          <>
            {status.keyConfigured ? 'Key saved.' : 'No key saved.'} {status.decisionsLogged ?? 0} sorter decision(s) logged
            {status.decisionLog ? ` in ${status.decisionLog}` : ''}.
          </>
        ) : null}
        {error ? <div style={{ color: 'var(--nim-error)' }}>{error}</div> : null}
      </section>
    </div>
  );
}

const BUTTON = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--nim-border)',
  background: 'transparent',
  color: 'var(--nim-text)',
  cursor: 'pointer',
} as const;

const ALPHA_BADGE = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid var(--nim-warning)',
  color: 'var(--nim-warning)',
} as const;

const BUTTON_PRIMARY = {
  ...BUTTON,
  border: '1px solid var(--nim-primary)',
  background: 'var(--nim-primary)',
  color: '#fff',
} as const;
