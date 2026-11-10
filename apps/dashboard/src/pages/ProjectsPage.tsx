import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Globe,
  Lock,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AdapterCheckItem,
  Project,
  ProjectCreateRequest,
  ProjectUpdateRequest,
} from '@payclinic/contracts';
import { api, onAuthRequired, setAdminToken, type ApiClient } from '../api/client';
import { isSafeHttpUrl } from '../lib/url';
import { useProjects } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

export interface ProjectsPageProps {
  client?: ApiClient;
}

interface ProjectFormData {
  name: string;
  baseUrl: string;
  adminSecret: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  sourceRoot: string;
}

const EMPTY_FORM: ProjectFormData = {
  name: '',
  baseUrl: '',
  adminSecret: '',
  repoOwner: '',
  repoName: '',
  repoBranch: '',
  sourceRoot: '',
};

function isValidUrl(val: string): boolean {
  if (!val.trim()) return true; // optional in schema
  try {
    const u = new URL(val);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ProjectsPage({ client = api }: ProjectsPageProps) {
  const { data: projects, loading, error, reload } = useProjects(client);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  // Dialog states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState<ProjectFormData>(EMPTY_FORM);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Connection check modal state
  const [checkingProject, setCheckingProject] = useState<Project | null>(null);
  const [checkResults, setCheckResults] = useState<AdapterCheckItem[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Auth unlock modal state
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [adminTokenInput, setAdminTokenInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    return onAuthRequired(() => {
      setShowUnlockDialog(true);
    });
  }, []);

  useEffect(() => {
    const res = client.getSettings?.();
    if (res && typeof res.then === 'function') {
      res
        .then((s) => {
          if (s?.publicUrl?.hint) {
            setPublicUrl(s.publicUrl.hint);
          }
        })
        .catch(() => {});
    }
  }, [client]);

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminTokenInput.trim()) return;
    setUnlocking(true);
    try {
      setAdminToken(adminTokenInput.trim());
      await client.getAuthStatus();
      setShowUnlockDialog(false);
      setAdminTokenInput('');
      toast.success('Admin access unlocked');
      reload();
    } catch {
      toast.error('Invalid admin token');
    } finally {
      setUnlocking(false);
    }
  };

  const openAdd = () => {
    setFormData(EMPTY_FORM);
    setUrlError(null);
    setIsAddOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditingProject(p);
    setFormData({
      name: p.name,
      baseUrl: p.baseUrl ?? '',
      adminSecret: '',
      repoOwner: p.repoOwner ?? '',
      repoName: p.repoName ?? '',
      repoBranch: p.repoBranch ?? '',
      sourceRoot: p.sourceRoot ?? '',
    });
    setUrlError(null);
  };

  const closeDialogs = () => {
    setIsAddOpen(false);
    setEditingProject(null);
    setDeletingProject(null);
    setCheckingProject(null);
    setCheckResults(null);
    setUrlError(null);
    setSubmitting(false);
    setIsChecking(false);
  };

  const handleCheck = async (p: Project) => {
    setCheckingProject(p);
    setCheckResults(null);
    setIsChecking(true);
    try {
      const results = await client.checkProject(p.id);
      setCheckResults(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Check failed: ${msg}`);
      setCheckResults([
        {
          id: 'error',
          endpoint: 'CONNECTION',
          ok: false,
          detail: msg,
          fix: 'Verify the site is reachable and your settings allow private targets if running locally.',
        },
      ]);
    } finally {
      setIsChecking(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Project name is required');
      return;
    }

    if (formData.baseUrl && !isValidUrl(formData.baseUrl)) {
      setUrlError('URL must start with http:// or https://');
      toast.error('Invalid base URL');
      return;
    }
    setUrlError(null);

    setSubmitting(true);
    try {
      if (editingProject) {
        const updatePayload: ProjectUpdateRequest = {
          name: formData.name.trim(),
          baseUrl: formData.baseUrl.trim() || null,
          adminSecret: formData.adminSecret ? formData.adminSecret : undefined,
          repoOwner: formData.repoOwner.trim() || null,
          repoName: formData.repoName.trim() || null,
          repoBranch: formData.repoBranch.trim() || null,
          sourceRoot: formData.sourceRoot.trim() || null,
        };
        await client.updateProject(editingProject.id, updatePayload);
        toast.success(`Updated project "${formData.name.trim()}"`);
      } else {
        const createPayload: ProjectCreateRequest = {
          name: formData.name.trim(),
          baseUrl: formData.baseUrl.trim() || null,
          adminSecret: formData.adminSecret || null,
          repoOwner: formData.repoOwner.trim() || null,
          repoName: formData.repoName.trim() || null,
          repoBranch: formData.repoBranch.trim() || null,
          sourceRoot: formData.sourceRoot.trim() || null,
        };
        await client.createProject(createPayload);
        toast.success(`Added website "${formData.name.trim()}"`);
      }
      closeDialogs();
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProject) return;
    setSubmitting(true);
    try {
      await client.deleteProject(deletingProject.id);
      toast.success(`Deleted project "${deletingProject.name}"`);
      closeDialogs();
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const [retestingId, setRetestingId] = useState<string | null>(null);

  const handleRetest = async (p: Project) => {
    if (retestingId) return;
    setRetestingId(p.id);
    try {
      const runs = await (client?.listRuns ? client.listRuns() : api.listRuns());
      const projectRun = runs.find((r) => r.projectId === p.id);
      if (!projectRun) {
        toast.info(`No runs found for project "${p.name}". Run a diagnosis first.`);
        return;
      }
      const res = client?.retestProject
        ? await client.retestProject(p.id, projectRun.id)
        : await api.retestProject(p.id, projectRun.id);
      toast.success(`Re-test completed for ${p.name}! Score: ${res.score}`);
    } catch (err) {
      toast.error(`Re-test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetestingId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="projects-page" data-testid="projects-page">
      <div className="projects-header">
        <div>
          <h1 className="projects-title">Projects</h1>
          <p className="projects-subtitle">Connected websites and stores</p>
        </div>
        <div className="projects-header-actions" style={{ display: 'flex', gap: '0.75rem' }}>
          <a
            href="/api/docs/connect-your-site"
            download="CONNECT-YOUR-SITE.md"
            className="button button--secondary"
            data-testid="download-guide-btn"
          >
            <Download size={16} />
            Download integration guide
          </a>
          <Button className="button--primary" onClick={openAdd} data-testid="add-website-button">
            <Plus size={16} />
            Add website
          </Button>
        </div>
      </div>

      <div
        className="projects-privacy-notice"
        data-testid="projects-privacy-notice"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          fontSize: '0.84rem',
          color: '#94a3b8',
          lineHeight: '1.4',
        }}
      >
        <strong>Data Privacy Disclosure:</strong> Diagnostic traces and relevant store source files
        are transmitted to Google Gemini for root-cause analysis and patch proposals. When you open
        a PR, PayClinic commits changes to your configured GitHub repo. Credentials and tokens are
        always masked and never sent to external AI models.
      </div>

      {loading && (
        <div className="projects-loading" data-testid="projects-loading">
          <Spinner label="Loading projects…" />
        </div>
      )}

      {error && (
        <div className="projects-error" role="alert">
          <AlertCircle size={20} />
          <span>Failed to load projects: {error.message}</span>
          <Button onClick={reload}>Retry</Button>
        </div>
      )}

      {!loading && projects && (
        <div className="projects-grid" data-testid="projects-grid">
          {projects.map((p) => {
            const isBuiltin = p.kind === 'builtin' || p.id === 'builtin';
            const paypalBaseUrl = publicUrl
              ? `${publicUrl.replace(/\/+$/, '')}/paypal-proxy/${p.proxyToken}`
              : `http://localhost:4000/paypal-proxy/${p.proxyToken}`;

            return (
              <Card key={p.id} className="project-card" data-testid={`project-card-${p.id}`}>
                <div className="project-card__header">
                  <div className="project-card__title-group">
                    <div className="project-card__icon-tile">
                      {isBuiltin ? <FolderGit2 size={20} /> : <Globe size={20} />}
                    </div>
                    <div>
                      <h2 className="project-card__title">{p.name}</h2>
                      <span className="project-card__id">{p.id}</span>
                    </div>
                  </div>
                  {isBuiltin ? <Badge tone="ok">Demo</Badge> : <Badge tone="medium">Remote</Badge>}
                </div>

                <div className="project-card__body">
                  <div className="project-card__detail">
                    <span className="project-card__label">Base URL</span>
                    <span className="project-card__value">
                      {p.baseUrl ? (
                        isSafeHttpUrl(p.baseUrl) ? (
                          <a
                            href={p.baseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="project-card__link"
                          >
                            {p.baseUrl}
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="project-card__link text-muted">{p.baseUrl}</span>
                        )
                      ) : (
                        <span className="text-muted">None (local test store)</span>
                      )}
                    </span>
                  </div>

                  <div
                    className="project-card__detail"
                    style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}
                  >
                    <span className="project-card__label">PAYPAL_BASE_URL for site</span>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        background: 'var(--surface-raised, #22252e)',
                        borderRadius: '6px',
                        padding: '0.35rem 0.5rem',
                        fontSize: '0.78rem',
                        fontFamily: 'monospace',
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        PAYPAL_BASE_URL={paypalBaseUrl}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`PAYPAL_BASE_URL=${paypalBaseUrl}`)}
                        className="button button--icon button--sm"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          padding: '0.1rem',
                          cursor: 'pointer',
                        }}
                        title="Copy configuration"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                    {!publicUrl && !isBuiltin && (
                      <span
                        style={{
                          color: '#f59e0b',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        <AlertTriangle size={12} /> Public URL empty in Settings
                      </span>
                    )}
                  </div>

                  <div className="project-card__detail">
                    <span className="project-card__label">Admin Secret</span>
                    <span className="project-card__value">
                      {p.hasAdminSecret ? (
                        <span className="project-card__badge-tag ok">
                          <CheckCircle2 size={12} /> Configured
                        </span>
                      ) : (
                        <span className="project-card__badge-tag neutral">Not set</span>
                      )}
                    </span>
                  </div>

                  {(p.repoOwner || p.repoName) && (
                    <div className="project-card__detail">
                      <span className="project-card__label">GitHub</span>
                      <span className="project-card__value">
                        <GitBranch size={12} /> {p.repoOwner}/{p.repoName}
                        {p.repoBranch ? ` (${p.repoBranch})` : ''}
                      </span>
                    </div>
                  )}
                </div>

                <div className="project-card__actions">
                  <button
                    type="button"
                    className="button button--secondary button--sm"
                    onClick={() => handleCheck(p)}
                    data-testid={`check-connection-${p.id}`}
                  >
                    <Radio size={14} />
                    Check connection
                  </button>

                  <button
                    type="button"
                    className="button button--secondary button--sm"
                    onClick={() => handleRetest(p)}
                    disabled={retestingId === p.id}
                    data-testid={`retest-project-${p.id}`}
                  >
                    <RotateCcw size={14} className={retestingId === p.id ? 'spin' : ''} />
                    {retestingId === p.id ? 'Re-testing…' : 'Re-test'}
                  </button>

                  <div className="project-card__edit-actions">
                    <button
                      type="button"
                      className="button button--icon button--sm"
                      title={isBuiltin ? 'Builtin project cannot be edited' : 'Edit project'}
                      disabled={isBuiltin}
                      onClick={() => openEdit(p)}
                      data-testid={`edit-project-${p.id}`}
                    >
                      <Pencil size={15} />
                    </button>

                    <button
                      type="button"
                      className="button button--icon button--danger button--sm"
                      title={isBuiltin ? 'Builtin project cannot be deleted' : 'Delete project'}
                      disabled={isBuiltin}
                      onClick={() => setDeletingProject(p)}
                      data-testid={`delete-project-${p.id}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Check Connection Modal */}
      {checkingProject && (
        <div
          className="settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="check-dialog-title"
          data-testid="check-connection-dialog"
        >
          <div className="settings-modal" style={{ maxWidth: '640px' }}>
            <div className="settings-modal__header">
              <Radio size={20} className="settings-modal__icon" />
              <h3 id="check-dialog-title" className="settings-modal__title">
                Adapter Checklist: {checkingProject.name}
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeDialogs}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="checklist-container" style={{ margin: '1rem 0' }}>
              {isChecking && (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Spinner label="Checking adapter endpoints…" />
                </div>
              )}

              {!isChecking && checkResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {checkResults.map((item) => (
                    <div
                      key={item.id}
                      className={`checklist-item ${item.ok ? 'checklist-item--ok' : 'checklist-item--fail'}`}
                      style={{
                        padding: '0.85rem',
                        borderRadius: '8px',
                        background: item.ok
                          ? 'rgba(16, 185, 129, 0.08)'
                          : 'rgba(239, 68, 68, 0.08)',
                        border: `1px solid ${item.ok ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                      }}
                      data-testid={`checklist-row-${item.id}`}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '0.35rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {item.ok ? (
                            <CheckCircle2 size={18} color="#10b981" />
                          ) : (
                            <XCircle size={18} color="#ef4444" />
                          )}
                          <strong style={{ fontSize: '0.9rem' }}>{item.endpoint}</strong>
                        </div>
                        <Badge tone={item.ok ? 'ok' : 'critical'}>
                          {item.ok ? 'Passed' : 'Failed'}
                        </Badge>
                      </div>

                      <p
                        style={{
                          margin: '0.2rem 0 0 1.6rem',
                          fontSize: '0.84rem',
                          color: 'var(--muted, #aaa)',
                        }}
                      >
                        {item.detail}
                      </p>

                      {item.fix && (
                        <div
                          style={{
                            margin: '0.5rem 0 0 1.6rem',
                            padding: '0.5rem 0.65rem',
                            borderRadius: '6px',
                            background: 'rgba(0,0,0,0.3)',
                            fontSize: '0.82rem',
                            color: '#f87171',
                          }}
                        >
                          <strong>Fix:</strong> {item.fix}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settings-modal__actions">
              <button type="button" className="button button--secondary" onClick={closeDialogs}>
                Close
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => handleCheck(checkingProject)}
                disabled={isChecking}
              >
                Re-check
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Dialog */}
      {(isAddOpen || editingProject) && (
        <div
          className="settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-dialog-title"
          data-testid="project-form-dialog"
        >
          <div className="settings-modal project-modal">
            <div className="settings-modal__header">
              <FolderGit2 size={20} className="settings-modal__icon" />
              <h3 id="project-dialog-title" className="settings-modal__title">
                {editingProject ? 'Edit website' : 'Add website'}
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeDialogs}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="settings-modal__form">
              <div className="settings-field">
                <label htmlFor="proj-name">Name *</label>
                <input
                  id="proj-name"
                  data-testid="project-name-input"
                  type="text"
                  className="settings-input"
                  placeholder="My Store"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>

              <div className="settings-field">
                <label htmlFor="proj-base-url">Base URL</label>
                <input
                  id="proj-base-url"
                  data-testid="project-base-url-input"
                  type="text"
                  className={`settings-input ${urlError ? 'settings-input--error' : ''}`}
                  placeholder="https://mystore.com"
                  value={formData.baseUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({ ...prev, baseUrl: val }));
                    if (val && !isValidUrl(val)) {
                      setUrlError('URL must start with http:// or https://');
                    } else {
                      setUrlError(null);
                    }
                  }}
                />
                {urlError && (
                  <span className="field-error-text" data-testid="url-error" role="alert">
                    {urlError}
                  </span>
                )}
              </div>

              <div className="settings-field">
                <label htmlFor="proj-admin-secret">
                  Admin Secret {editingProject ? '(leave blank to keep current)' : ''}
                </label>
                <input
                  id="proj-admin-secret"
                  data-testid="project-admin-secret-input"
                  type="password"
                  className="settings-input"
                  placeholder="••••••••"
                  value={formData.adminSecret}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, adminSecret: e.target.value }))
                  }
                />
              </div>

              <div className="project-modal__row">
                <div className="settings-field">
                  <label htmlFor="proj-github-owner">GitHub Owner (optional)</label>
                  <input
                    id="proj-github-owner"
                    data-testid="project-repo-owner-input"
                    type="text"
                    className="settings-input"
                    placeholder="acme-corp"
                    value={formData.repoOwner}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, repoOwner: e.target.value }))
                    }
                  />
                </div>

                <div className="settings-field">
                  <label htmlFor="proj-github-repo">GitHub Repo (optional)</label>
                  <input
                    id="proj-github-repo"
                    data-testid="project-repo-name-input"
                    type="text"
                    className="settings-input"
                    placeholder="store-repo"
                    value={formData.repoName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, repoName: e.target.value }))}
                  />
                </div>
              </div>

              <div className="project-modal__row">
                <div className="settings-field">
                  <label htmlFor="proj-github-branch">GitHub Branch (optional)</label>
                  <input
                    id="proj-github-branch"
                    data-testid="project-repo-branch-input"
                    type="text"
                    className="settings-input"
                    placeholder="main"
                    value={formData.repoBranch}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, repoBranch: e.target.value }))
                    }
                  />
                </div>

                <div className="settings-field">
                  <label htmlFor="proj-source-root">Source Folder (optional)</label>
                  <input
                    id="proj-source-root"
                    data-testid="project-source-root-input"
                    type="text"
                    className="settings-input"
                    placeholder="apps/web"
                    value={formData.sourceRoot}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, sourceRoot: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="settings-modal__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={closeDialogs}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={submitting || Boolean(urlError)}
                  data-testid="save-project-button"
                >
                  {submitting ? 'Saving…' : editingProject ? 'Save changes' : 'Add website'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingProject && (
        <div
          className="settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          data-testid="delete-project-dialog"
        >
          <div className="settings-modal">
            <div className="settings-modal__header">
              <Trash2 size={20} className="settings-modal__icon text-danger" />
              <h3 id="delete-dialog-title" className="settings-modal__title">
                Delete project
              </h3>
            </div>
            <p className="settings-modal__desc">
              Are you sure you want to delete <strong>{deletingProject.name}</strong>? This action
              cannot be undone.
            </p>
            <div className="settings-modal__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={closeDialogs}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={handleDelete}
                disabled={submitting}
                data-testid="confirm-delete-button"
              >
                {submitting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Settings / Admin Modal */}
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
                Unlock admin access
              </h3>
            </div>
            <p className="settings-modal__desc">
              An admin token is required to view or modify projects.
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
                  {unlocking ? 'Unlocking…' : 'Unlock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
