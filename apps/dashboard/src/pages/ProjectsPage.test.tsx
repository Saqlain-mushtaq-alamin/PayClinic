import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Project, SettingsResponse } from '@payclinic/contracts';
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
    health: vi.fn(async () => ({
      ok: true as const,
      mode: 'offline' as const,
      version: '1.0',
      aiProvider: 'fixture',
    })),
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
    getSettings: vi.fn(
      async () => ({ mode: { configured: true, hint: 'offline' } }) as unknown as SettingsResponse,
    ),
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
    checkProject: vi.fn(async () => [
      {
        id: 'products',
        endpoint: 'GET /api/products',
        ok: true,
        detail: 'Returns 3 products including all required SKUs',
        fix: null,
      },
      {
        id: 'orders',
        endpoint: 'POST /api/orders',
        ok: false,
        detail: 'Expected HTTP 201, got 500',
        fix: 'Implement POST /api/orders accepting { cartId, items } and creating an order via PAYPAL_BASE_URL.',
      },
    ]),
    retestProject: vi.fn(async () => ({ ok: true, score: 100, findings: [] })),
    ...overrides,
  };
}

describe('ProjectsPage', () => {
  it('renders project cards with Demo badge for builtin, download guide link, and PAYPAL_BASE_URL', async () => {
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

    // Download guide link exists
    const downloadLink = screen.getByTestId('download-guide-btn');
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute('href', '/api/docs/connect-your-site');

    // PAYPAL_BASE_URL is shown
    expect(screen.getByText(/PAYPAL_BASE_URL=.*remote-token/)).toBeInTheDocument();

    // Check connection button is enabled
    const checkBtn = screen.getByTestId('check-connection-remote-1');
    expect(checkBtn).not.toBeDisabled();

    // Builtin edit and delete are disabled
    expect(screen.getByTestId('edit-project-builtin')).toBeDisabled();
    expect(screen.getByTestId('delete-project-builtin')).toBeDisabled();

    // Remote edit and delete are enabled
    expect(screen.getByTestId('edit-project-remote-1')).not.toBeDisabled();
    expect(screen.getByTestId('delete-project-remote-1')).not.toBeDisabled();
  });

  it('runs connection checklist and displays passed/failed rows with fix text', async () => {
    const client = createMockClient();
    render(
      <MemoryRouter>
        <ProjectsPage client={client} />
      </MemoryRouter>,
    );

    await screen.findByText('Production Store');
    fireEvent.click(screen.getByTestId('check-connection-remote-1'));

    expect(screen.getByTestId('check-connection-dialog')).toBeInTheDocument();
    expect(await screen.findByText(/Adapter Checklist: Production Store/)).toBeInTheDocument();

    // Verified checklist rows
    expect(await screen.findByTestId('checklist-row-products')).toBeInTheDocument();
    expect(screen.getByTestId('checklist-row-orders')).toBeInTheDocument();

    // Passed and failed badges
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    // Fix text is visible for failed row
    expect(
      screen.getByText(
        /Implement POST \/api\/orders accepting \{ cartId, items \} and creating an order via PAYPAL_BASE_URL\./,
      ),
    ).toBeInTheDocument();
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
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-delete-button'));

    await waitFor(() => {
      expect(client.deleteProject).toHaveBeenCalledWith('remote-1');
    });
  });
});
