import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import { ApiError } from '../api/client';
import { RunsPage } from './RunsPage';
import '../test-setup';

const runs = mockData.runs as unknown as RunSummary[];

const renderPage = (listRuns: () => Promise<RunSummary[]>) =>
  render(
    <MemoryRouter>
      <RunsPage client={{ listRuns }} />
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

  it('shows the empty state', async () => {
    renderPage(async () => []);
    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
  });

  it('shows the error state with a Retry button', async () => {
    renderPage(async () => {
      throw new ApiError('boom', 500);
    });
    expect(await screen.findByText(/Failed to load runs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
