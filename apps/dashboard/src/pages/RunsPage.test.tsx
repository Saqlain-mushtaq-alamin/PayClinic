import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Health, RunSummary } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import { ApiError } from '../api/client';
import { DashboardProvider } from '../context/DashboardContext';
import { RunsPage } from './RunsPage';
import '../test-setup';

const runs = mockData.runs as unknown as RunSummary[];
const offline: Health = { ok: true, mode: 'offline', version: 'mock', aiProvider: 'fixture' };

const renderPage = (listRuns: () => Promise<RunSummary[]>) =>
  render(
    <MemoryRouter>
      <DashboardProvider>
        <RunsPage
          client={{
            listRuns,
            getScenarios: async () => [],
            health: async () => offline,
            createRun: async () => ({ runId: 'run-1' }),
          }}
        />
      </DashboardProvider>
    </MemoryRouter>,
  );

describe('RunsPage', () => {
  it('shows the three mock runs', async () => {
    renderPage(async () => runs);
    expect(await screen.findByText('run-1')).toBeInTheDocument();
    expect(screen.getByText('run-2')).toBeInTheDocument();
    expect(screen.getByText('run-3')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('shows the empty state with the diagnosis shortcut button', async () => {
    renderPage(async () => []);
    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start your first diagnosis' })).toBeInTheDocument();
  });

  it('renders all 3 cards in the grid: Payment Safety, Score History, Diagnose', async () => {
    renderPage(async () => runs);
    expect(await screen.findByText('Payment Safety')).toBeInTheDocument();
    expect(screen.getByText('Score history')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Diagnose/i })).toBeInTheDocument();
  });

  it('filters runs with the search bar on top of recent runs', async () => {
    renderPage(async () => runs);
    const searchInput = (await screen.findByTestId('search-input')) as HTMLInputElement;
    expect(searchInput).toBeInTheDocument();

    expect(screen.getByText('run-1')).toBeInTheDocument();
    expect(screen.getByText('run-2')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'run-1' } });
    expect(searchInput.value).toBe('run-1');
    expect(screen.getByText('run-1')).toBeInTheDocument();
    expect(screen.queryByText('run-2')).not.toBeInTheDocument();
  });

  it('shows the error state with a Retry button', async () => {
    renderPage(async () => {
      throw new ApiError('boom', 500);
    });
    expect(await screen.findByText(/Failed to load runs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the project name for each run', async () => {
    renderPage(async () => runs);
    const projectLabels = await screen.findAllByTestId('run-project-name');
    expect(projectLabels.length).toBeGreaterThan(0);
    expect(projectLabels[0]).toHaveTextContent('Demo store');
  });
});
