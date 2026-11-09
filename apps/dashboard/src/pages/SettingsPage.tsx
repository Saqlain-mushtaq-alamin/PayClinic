import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  FolderGit2,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Radio,
  Save,
  ShieldAlert,
  TestTube2,
  XCircle,
} from 'lucide-react';
import type { SettingsResponse, TestSettingsResponse } from '@payclinic/contracts';
import { api, onAuthRequired, setAdminToken, type ApiClient } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

export interface SettingsPageProps {
  client?: ApiClient;
}

export function SettingsPage({ client = api }: SettingsPageProps) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string } | undefined>
  >({});
  const [isPayPalVerified, setIsPayPalVerified] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [adminTokenInput, setAdminTokenInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await client.getSettings();
      setSettings(data);
      if (data.paypalVerifiedAt?.configured) {
        setIsPayPalVerified(true);
      }
      setShowUnlockDialog(false);
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'status' in err && err.status === 401) {
        setShowUnlockDialog(true);
      } else {
        toast.error('Failed to load settings');
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchSettings();
    const unsubscribe = onAuthRequired(() => {
      setShowUnlockDialog(true);
    });
    return unsubscribe;
  }, [fetchSettings]);

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    const token = adminTokenInput.trim();
    if (!token) return;

    setUnlocking(true);
    setAdminToken(token);
    try {
      const data = await client.getSettings();
      setSettings(data);
      if (data.paypalVerifiedAt?.configured) {
        setIsPayPalVerified(true);
      }
      setShowUnlockDialog(false);
      toast.success('Settings unlocked');
    } catch {
      toast.error('Invalid admin token');
    } finally {
      setUnlocking(false);
    }
  };

  const handleSave = async (cardKey: string, cardTitle: string, keys: string[]) => {
    setSaving(cardKey);
    try {
      const updates: Record<string, string> = {};
      for (const k of keys) {
        if (draft[k] !== undefined && draft[k] !== '') {
          updates[k] = draft[k];
        }
      }

      if (Object.keys(updates).length === 0) {
        toast.info('No changes to save');
        return;
      }

      const updated = await client.saveSettings(updates);
      setSettings(updated);
      setDraft((prev) => {
        const next = { ...prev };
        for (const k of keys) delete next[k];
        return next;
      });
      toast.success(`${cardTitle} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${cardTitle}`);
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (kind: 'paypal' | 'gemini' | 'github') => {
    setTesting(kind);
    try {
      const res: TestSettingsResponse = await client.testSetting(kind);
      setTestResults((prev) => ({ ...prev, [kind]: res }));
      if (res.ok) {
        toast.success(res.message);
        if (kind === 'paypal') {
          setIsPayPalVerified(true);
          try {
            const fresh = await client.getSettings();
            setSettings(fresh);
          } catch {
            // keep existing
          }
        }
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      setTestResults((prev) => ({ ...prev, [kind]: { ok: false, message: msg } }));
      toast.error(msg);
    } finally {
      setTesting(null);
    }
  };

  const paypalConfigured = Boolean(
    settings?.paypalClientId?.configured && settings?.paypalClientSecret?.configured,
  );
  const currentProvider = draft.aiProvider ?? settings?.aiProvider?.hint ?? 'fixture';
  const aiConfigured =
    currentProvider === 'fixture' ||
    Boolean(settings?.geminiApiKey?.configured || draft.geminiApiKey);
  const githubConfigured = Boolean(
    settings?.githubToken?.configured && settings?.githubRepo?.configured,
  );
  const currentMode = draft.mode ?? settings?.mode?.hint ?? 'offline';
  const publicUrlConfigured = Boolean(settings?.publicUrl?.configured);

  return (
    <div className="settings-page" data-testid="settings-page">
      {/* Top Banner */}
      <div className="settings-banner" role="alert" data-testid="settings-banner">
        <ShieldAlert size={20} className="settings-banner__icon" />
        <span className="settings-banner__text">
          Sandbox only. PayClinic never uses live PayPal credentials.
        </span>
      </div>

      <header className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">
          Configure PayPal sandbox, AI prescriber, and GitHub integration.
        </p>
      </header>

      {loading && !settings ? (
        <div className="settings-loading">
          <Loader2 className="animate-spin" size={28} />
          <span>Loading settings...</span>
        </div>
      ) : (
        <div className="settings-grid">
          {/* Card 1: PayPal sandbox */}
          <Card className="settings-card" id="settings-paypal">
            <div className="settings-card__header">
              <div className="settings-card__title-group">
                <KeyRound size={20} className="settings-card__icon" />
                <h2 className="settings-card__title">PayPal sandbox</h2>
              </div>
              <Badge tone={paypalConfigured ? 'ok' : 'neutral'}>
                {paypalConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <p className="settings-card__desc">
              Sandbox REST credentials used to simulate or reach PayPal sandbox.
            </p>

            <div className="settings-form">
              <div className="settings-field">
                <label htmlFor="paypal-client-id">Client ID</label>
                <input
                  id="paypal-client-id"
                  data-testid="paypal-client-id"
                  type="password"
                  className="settings-input"
                  placeholder={settings?.paypalClientId?.hint || '••••••••'}
                  value={draft.paypalClientId ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, paypalClientId: e.target.value }))}
                />
              </div>

              <div className="settings-field">
                <label htmlFor="paypal-client-secret">Client Secret</label>
                <input
                  id="paypal-client-secret"
                  data-testid="paypal-client-secret"
                  type="password"
                  className="settings-input"
                  placeholder={settings?.paypalClientSecret?.hint || '••••••••'}
                  value={draft.paypalClientSecret ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, paypalClientSecret: e.target.value }))}
                />
              </div>

              <div className="settings-actions">
                <button
                  type="button"
                  data-testid="save-paypal-button"
                  className="button button--primary"
                  disabled={saving === 'paypal'}
                  onClick={() =>
                    handleSave('paypal', 'PayPal sandbox', ['paypalClientId', 'paypalClientSecret'])
                  }
                >
                  {saving === 'paypal' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save
                </button>

                <button
                  type="button"
                  data-testid="test-paypal-button"
                  className="button button--secondary"
                  disabled={testing === 'paypal'}
                  onClick={() => handleTest('paypal')}
                >
                  {testing === 'paypal' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <TestTube2 size={16} />
                  )}
                  Test connection
                </button>
              </div>

              {testResults.paypal && (
                <div
                  className={`settings-result ${
                    testResults.paypal.ok ? 'settings-result--ok' : 'settings-result--error'
                  }`}
                  data-testid="paypal-test-result"
                >
                  {testResults.paypal.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <span>{testResults.paypal.message}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Card 2: AI */}
          <Card className="settings-card" id="settings-ai">
            <div className="settings-card__header">
              <div className="settings-card__title-group">
                <Bot size={20} className="settings-card__icon" />
                <h2 className="settings-card__title">AI</h2>
              </div>
              <Badge tone={aiConfigured ? 'ok' : 'neutral'}>
                {aiConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <p className="settings-card__desc">
              AI provider used to explain findings and generate repair patches.
            </p>

            <div className="settings-form">
              <div className="settings-field">
                <label htmlFor="ai-provider">Provider</label>
                <select
                  id="ai-provider"
                  data-testid="ai-provider-select"
                  className="settings-select"
                  value={currentProvider}
                  onChange={(e) => setDraft((d) => ({ ...d, aiProvider: e.target.value }))}
                >
                  <option value="fixture">fixture</option>
                  <option value="gemini">gemini</option>
                </select>
              </div>

              <div className="settings-field">
                <label htmlFor="gemini-key">Gemini API Key</label>
                <input
                  id="gemini-key"
                  data-testid="gemini-key-input"
                  type="password"
                  className="settings-input"
                  placeholder={settings?.geminiApiKey?.hint || '••••••••'}
                  value={draft.geminiApiKey ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, geminiApiKey: e.target.value }))}
                />
              </div>

              <div className="settings-field">
                <label htmlFor="gemini-model">Model</label>
                <input
                  id="gemini-model"
                  data-testid="gemini-model-input"
                  type="text"
                  className="settings-input"
                  placeholder={settings?.geminiModel?.hint || 'gemini-2.5-flash'}
                  value={draft.geminiModel ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, geminiModel: e.target.value }))}
                />
              </div>

              <div className="settings-actions">
                <button
                  type="button"
                  data-testid="save-ai-button"
                  className="button button--primary"
                  disabled={saving === 'ai'}
                  onClick={() =>
                    handleSave('ai', 'AI settings', ['aiProvider', 'geminiApiKey', 'geminiModel'])
                  }
                >
                  {saving === 'ai' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save
                </button>

                <button
                  type="button"
                  data-testid="test-ai-button"
                  className="button button--secondary"
                  disabled={testing === 'gemini'}
                  onClick={() => handleTest('gemini')}
                >
                  {testing === 'gemini' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <TestTube2 size={16} />
                  )}
                  Test connection
                </button>
              </div>

              {testResults.gemini && (
                <div
                  className={`settings-result ${
                    testResults.gemini.ok ? 'settings-result--ok' : 'settings-result--error'
                  }`}
                  data-testid="ai-test-result"
                >
                  {testResults.gemini.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <span>{testResults.gemini.message}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Card 3: GitHub */}
          <Card className="settings-card" id="settings-github">
            <div className="settings-card__header">
              <div className="settings-card__title-group">
                <Globe size={20} className="settings-card__icon" />
                <h2 className="settings-card__title">GitHub</h2>
              </div>
              <Badge tone={githubConfigured ? 'ok' : 'neutral'}>
                {githubConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <p className="settings-card__desc">
              Open pull requests directly from verified repair patches.
            </p>

            <div className="settings-form">
              <div className="settings-field">
                <label htmlFor="github-token">Personal Access Token</label>
                <input
                  id="github-token"
                  data-testid="github-token-input"
                  type="password"
                  className="settings-input"
                  placeholder={settings?.githubToken?.hint || '••••••••'}
                  value={draft.githubToken ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, githubToken: e.target.value }))}
                />
              </div>

              <div className="settings-field">
                <label htmlFor="github-repo">Repository (owner/repo)</label>
                <input
                  id="github-repo"
                  data-testid="github-repo-input"
                  type="text"
                  className="settings-input"
                  placeholder={settings?.githubRepo?.hint || 'owner/repo'}
                  value={draft.githubRepo ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, githubRepo: e.target.value }))}
                />
              </div>

              <div className="settings-field">
                <label htmlFor="github-branch">Base Branch</label>
                <input
                  id="github-branch"
                  data-testid="github-branch-input"
                  type="text"
                  className="settings-input"
                  placeholder={settings?.githubBaseBranch?.hint || 'main'}
                  value={draft.githubBaseBranch ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, githubBaseBranch: e.target.value }))}
                />
              </div>

              <div className="settings-actions">
                <button
                  type="button"
                  data-testid="save-github-button"
                  className="button button--primary"
                  disabled={saving === 'github'}
                  onClick={() =>
                    handleSave('github', 'GitHub settings', [
                      'githubToken',
                      'githubRepo',
                      'githubBaseBranch',
                    ])
                  }
                >
                  {saving === 'github' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save
                </button>

                <button
                  type="button"
                  data-testid="test-github-button"
                  className="button button--secondary"
                  disabled={testing === 'github'}
                  onClick={() => handleTest('github')}
                >
                  {testing === 'github' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <TestTube2 size={16} />
                  )}
                  Test connection
                </button>
              </div>

              {testResults.github && (
                <div
                  className={`settings-result ${
                    testResults.github.ok ? 'settings-result--ok' : 'settings-result--error'
                  }`}
                  data-testid="github-test-result"
                >
                  {testResults.github.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <span>{testResults.github.message}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Card 4: Mode */}
          <Card className="settings-card" id="settings-mode">
            <div className="settings-card__header">
              <div className="settings-card__title-group">
                <Radio size={20} className="settings-card__icon" />
                <h2 className="settings-card__title">Mode</h2>
              </div>
              <Badge tone={currentMode === 'online' ? 'ok' : 'neutral'}>
                {currentMode === 'online' ? 'Live sandbox' : 'Offline demo'}
              </Badge>
            </div>
            <p className="settings-card__desc">
              Choose offline simulation or live sandbox testing.
            </p>

            <div className="settings-form">
              <div className="settings-radio-group">
                <label className="settings-radio-label">
                  <input
                    type="radio"
                    name="mode"
                    data-testid="mode-offline-radio"
                    value="offline"
                    checked={currentMode === 'offline'}
                    onChange={() => setDraft((d) => ({ ...d, mode: 'offline' }))}
                  />
                  <div>
                    <div className="settings-radio-title">Offline demo</div>
                    <div className="settings-radio-desc">
                      Fast local deterministic PayPal simulator (default).
                    </div>
                  </div>
                </label>

                <label
                  className={`settings-radio-label ${
                    !isPayPalVerified ? 'settings-radio-label--disabled' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    data-testid="mode-online-radio"
                    value="online"
                    checked={currentMode === 'online'}
                    disabled={!isPayPalVerified}
                    onChange={() => setDraft((d) => ({ ...d, mode: 'online' }))}
                  />
                  <div>
                    <div className="settings-radio-title">Online sandbox</div>
                    <div className="settings-radio-desc">
                      Real PayPal sandbox testing (requires verified credentials).
                    </div>
                  </div>
                </label>
              </div>

              {!isPayPalVerified && (
                <div className="settings-field-hint" data-testid="mode-disabled-hint">
                  <AlertTriangle size={14} />
                  <span>Online mode is disabled until PayPal sandbox test passes.</span>
                </div>
              )}

              <div className="settings-actions">
                <button
                  type="button"
                  data-testid="save-mode-button"
                  className="button button--primary"
                  disabled={saving === 'mode'}
                  onClick={() => handleSave('mode', 'Mode', ['mode'])}
                >
                  {saving === 'mode' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save
                </button>
              </div>
            </div>
          </Card>

          {/* Card 5: Public URL */}
          <Card className="settings-card" id="settings-public-url">
            <div className="settings-card__header">
              <div className="settings-card__title-group">
                <Globe size={20} className="settings-card__icon" />
                <h2 className="settings-card__title">Public URL of PayClinic</h2>
              </div>
              <Badge tone={publicUrlConfigured ? 'ok' : 'neutral'}>
                {publicUrlConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <p className="settings-card__desc">
              Base URL used later to connect external stores and webhooks.
            </p>

            <div className="settings-form">
              <div className="settings-field">
                <label htmlFor="public-url">Public URL</label>
                <input
                  id="public-url"
                  data-testid="public-url-input"
                  type="text"
                  className="settings-input"
                  placeholder={settings?.publicUrl?.hint || 'http://localhost:4000'}
                  value={draft.publicUrl ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, publicUrl: e.target.value }))}
                />
              </div>

              <div className="settings-actions">
                <button
                  type="button"
                  data-testid="save-public-url-button"
                  className="button button--primary"
                  disabled={saving === 'publicUrl'}
                  onClick={() => handleSave('publicUrl', 'Public URL', ['publicUrl'])}
                >
                  {saving === 'publicUrl' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save
                </button>
              </div>
            </div>
          </Card>

          {/* Next steps link card */}
          <Card className="settings-card settings-card--next" data-testid="settings-projects-card">
            <div className="settings-card__header">
              <div className="settings-card__title-row">
                <FolderGit2 size={20} className="settings-card__icon" />
                <h3 className="settings-card__title">Connect Your Website</h3>
              </div>
            </div>
            <div className="settings-card__content">
              <p
                style={{
                  margin: '0 0 1rem 0',
                  color: 'var(--color-text-secondary, #666)',
                  fontSize: '0.875rem',
                }}
              >
                Next: add your website in Projects
              </p>
              <Link
                to="/projects"
                className="button button--secondary"
                data-testid="settings-to-projects-link"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  textDecoration: 'none',
                }}
              >
                <span>Next: add your website in Projects</span>
                <ArrowRight size={16} />
              </Link>
            </div>
          </Card>
        </div>
      )}

      {/* Unlock Settings Modal */}
      {showUnlockDialog && (
        <div
          className="settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unlock-title"
          data-testid="unlock-dialog"
        >
          <div className="settings-modal">
            <div className="settings-modal__header">
              <Lock size={20} className="settings-modal__icon" />
              <h3 id="unlock-title" className="settings-modal__title">
                Unlock settings
              </h3>
            </div>
            <p className="settings-modal__desc">
              An admin token is required to view and modify settings.
            </p>
            <form onSubmit={handleUnlock} className="settings-modal__form">
              <input
                type="password"
                data-testid="admin-token-input"
                className="settings-input"
                placeholder="Enter admin token"
                value={adminTokenInput}
                onChange={(e) => setAdminTokenInput(e.target.value)}
                autoFocus
              />
              <div className="settings-modal__actions">
                <button
                  type="submit"
                  data-testid="unlock-submit-button"
                  className="button button--primary"
                  disabled={unlocking || !adminTokenInput.trim()}
                >
                  {unlocking ? <Loader2 size={16} className="animate-spin" /> : null}
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
