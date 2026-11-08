import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@payclinic/contracts';
import type { ApiClient } from '../api/client';
import { ProjectsPage } from './ProjectsPage';
import '../test-setup';

const mockProjects: Project[] = [
  {
    id: 'builtin',
    name: 'Demo store',
    kind: 'builtin',
    baseUrl: null,
    proxyToken: 'builtin-token',
    proxyUrl: 'http://localhost:4000/proxy/builtin-token',
    hasAdminSecret: false,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    sourceRoot: null,
    createdAt: '2026-11-08T00:00:00.000Z',
  },
  {
    id: 'remote-1',
    name: 'Production Store',
    kind: 'remote',
    baseUrl: 'https://store.example.com',
    proxyToken: 'remote-token',
    proxyUrl: 'http://localhost:4000/proxy/remote-token',
    hasAdminSecret: true,
    repoOwner: 'org',
    repoName: 'repo',
    repoBranch: 'main',
    sourceRoot: 'web',
    createdAt: '2026-11-08T00:00:00.000Z',
  },
];

function createMockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    health: vi.fn(async () => ({ ok: true as const, mode: 'offline' as const, version: '1.0', aiProvider: 'fixture' })),
    listRuns: vi.fn(async () => []),
    createRun: vi.fn(async () => ({ runId: 'run-1' })),
    getRun: vi.fn(),
    getSteps: vi.fn(async () => []),
    getFinding: vi.fn(),
    prescribe: vi.fn(async () => ({ accepted: true as const })),
    openPr: vi.fn(),
    protect: vi.fn(async () => ({ accepted: true as const })),
    getPolicy: vi.fn(),
    getDecisions: vi.fn(async () => []),
    getScenarios: vi.fn(async () => []),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    testSetting: vi.fn(),
    getAuthStatus: vi.fn(async () => ({ required: false })),
    listProjects: vi.fn(async () => mockProjects),
    createProject: vi.fn(async (body) => ({
      id: 'new-proj',
      name: body.name,
      kind: 'remote' as const,
      baseUrl: body.baseUrl ?? null,
      proxyToken: 'tok',
      proxyUrl: 'http://localhost/proxy/tok',
      hasAdminSecret: Boolean(body.adminSecret),
      repoOwner: body.repoOwner ?? null,
      repoName: body.repoName ?? null,
      repoBranch: body.repoBranch ?? null,
      sourceRoot: body.sourceRoot ?? null,
      createdAt: '2026-11-08T00:00:00.000Z',
    })),
    updateProject: vi.fn(async (id, updates) => ({
      ...mockProjects[1]!,
      id,
      name: updates.name ?? mockProjects[1]!.name,
      baseUrl: updates.baseUrl !== undefined ? updates.baseUrl : mockProjects[1]!.baseUrl,
    })),
    deleteProject: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('ProjectsPage', () => {
  it('renders project cards with Demo badge for builtin and remote for others', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter>
        <ProjectsPage client={client} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Demo store')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('Production Store')).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();

    // Check connection button is disabled with tooltip
    const checkBtn = screen.getByTestId('check-connection-builtin');
    expect(checkBtn).toBeDisabled();
    expect(checkBtn).toHaveAttribute('title', 'Connection test available in Phase 5');

    // Builtin edit and delete are disabled
    expect(screen.getByTestId('edit-project-builtin')).toBeDisabled();
    expect(screen.getByTestId('delete-project-builtin')).toBeDisabled();

    // Remote edit and delete are enabled
    expect(screen.getByTestId('edit-project-remote-1')).not.toBeDisabled();
    expect(screen.getByTestId('delete-project-remote-1')).not.toBeDisabled();
  });

  it('validates URL client-side in Add website dialog', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter>
        <ProjectsPage client={client} />
      </MemoryRouter>,
    );

    await screen.findByText('Demo store');
    fireEvent.click(screen.getByTestId('add-website-button'));

    expect(screen.getByTestId('project-form-dialog')).toBeInTheDocument();

    const nameInput = screen.getByTestId('project-name-input');
    const urlInput = screen.getByTestId('project-base-url-input');
    const saveBtn = screen.getByTestId('save-project-button');

    fireEvent.change(nameInput, { target: { value: 'Invalid Store' } });
    fireEvent.change(urlInput, { target: { value: 'not-a-valid-url' } });

    // Should display validation error and disable submit button
    expect(await screen.findByTestId('url-error')).toBeInTheDocument();
    expect(screen.getByText(/URL must start with http:\/\/ or https:\/\//)).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    // Enter a valid URL
    fireEvent.change(urlInput, { target: { value: 'https://valid.store.com' } });
    expect(screen.queryByTestId('url-error')).not.toBeInTheDocument();
    expect(saveBtn).not.toBeDisabled();

    // Submit form
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(client.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Invalid Store',
          baseUrl: 'https://valid.store.com',
        }),
      );
    });
  });

  it('edits an existing remote project', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter>
        <ProjectsPage client={client} />
      </MemoryRouter>,
    );

    await screen.findByText('Production Store');
    fireEvent.click(screen.getByTestId('edit-project-remote-1'));

    expect(screen.getByTestId('project-form-dialog')).toBeInTheDocument();
    const nameInput = screen.getByTestId('project-name-input');
    expect(nameInput).toHaveValue('Production Store');

    fireEvent.change(nameInput, { target: { value: 'Updated Store Name' } });
    fireEvent.click(screen.getByTestId('save-project-button'));

    await waitFor(() => {
      expect(client.updateProject).toHaveBeenCalledWith(
        'remote-1',
        expect.objectContaining({
          name: 'Updated Store Name',
        }),
      );
    });
  });

  it('deletes a remote project upon confirmation', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter>
        <ProjectsPage client={client} />
      </MemoryRouter>,
    );

    await screen.findByText('Production Store');
    fireEvent.click(screen.getByTestId('delete-project-remote-1'));

    expect(screen.getByTestId('delete-project-dialog')).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to delete/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-delete-button'));

    await waitFor(() => {
      expect(client.deleteProject).toHaveBeenCalledWith('remote-1');
    });
  });
});
