import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Globe,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Radio,
  Trash2,
  X,
} from 'lucide-react';
import type { Project, ProjectCreateRequest, ProjectUpdateRequest } from '@payclinic/contracts';
import { api, onAuthRequired, setAdminToken, type ApiClient } from '../api/client';
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

  // Dialog states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState<ProjectFormData>(EMPTY_FORM);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auth unlock modal state
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [adminTokenInput, setAdminTokenInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    return onAuthRequired(() => {
      setShowUnlockDialog(true);
    });
  }, []);

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
    setUrlError(null);
    setSubmitting(false);
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

  return (
    <div className="projects-page" data-testid="projects-page">
      <div className="projects-header">
        <div>
          <h1 className="projects-title">Projects</h1>
          <p className="projects-subtitle">Connected websites and stores</p>
        </div>
        <Button
          className="button--primary"
          onClick={openAdd}
          data-testid="add-website-button"
        >
          <Plus size={16} />
          Add website
        </Button>
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

            return (
              <Card
                key={p.id}
                className="project-card"
                data-testid={`project-card-${p.id}`}
              >
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
                  {isBuiltin ? (
                    <Badge tone="ok">Demo</Badge>
                  ) : (
                    <Badge tone="medium">Remote</Badge>
                  )}
                </div>

                <div className="project-card__body">
                  <div className="project-card__detail">
                    <span className="project-card__label">Base URL</span>
                    <span className="project-card__value">
                      {p.baseUrl ? (
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
                        <span className="text-muted">None (local test store)</span>
                      )}
                    </span>
                  </div>

                  <div className="project-card__detail">
                    <span className="project-card__label">Proxy URL</span>
                    <span className="project-card__value project-card__code">
                      {p.proxyUrl}
                    </span>
                  </div>

                  <div className="project-card__detail">
                    <span className="project-card__label">Admin Secret</span>
                    <span className="project-card__value">
                      {p.hasAdminSecret ? (
                        <span className="project-card__badge-tag ok">
                          <CheckCircle2 size={12} /> Configured
                        </span>
                      ) : (
                        <span className="project-card__badge-tag neutral">
                          Not set
                        </span>
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
                    disabled
                    title="Connection test available in Phase 5"
                    data-testid={`check-connection-${p.id}`}
                  >
                    <Radio size={14} />
                    Check connection
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
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
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
                  <span
                    className="field-error-text"
                    data-testid="url-error"
                    role="alert"
                  >
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
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, repoName: e.target.value }))
                    }
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
              Are you sure you want to delete <strong>{deletingProject.name}</strong>?
              This action cannot be undone.
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
