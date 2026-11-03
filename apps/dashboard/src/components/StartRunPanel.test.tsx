import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Health, RunCreateResponse, ScenarioInfo } from '@payclinic/contracts';
import '../test-setup';
import { StartRunPanel, type StartRunClient } from './StartRunPanel';

const scenarios: ScenarioInfo[] = [
  { key: 'B1', title: 'Double capture', target: 'store', description: 'Two captures for one cart' },
  { key: 'B2', title: 'Cancel idempotency', target: 'store', description: 'Cancel reused twice' },
  { key: 'A1', title: 'Agent double spend', target: 'agent', description: 'Agent buys twice' },
];

const offline: Health = { ok: true, mode: 'offline', version: 'mock', aiProvider: 'fixture' };

function makeClient(over: Partial<StartRunClient> = {}): StartRunClient {
  return {
    getScenarios: vi.fn(async () => scenarios),
    health: vi.fn(async () => offline),
    createRun: vi.fn(async () => ({ runId: 'run-new' }) satisfies RunCreateResponse),
    ...over,
  };
}

const renderPanel = (client: StartRunClient) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StartRunPanel client={client} />} />
        <Route path="/runs/:id" element={<p>Run page reached</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('StartRunPanel', () => {
  it('lists merchant scenarios checked by default and shows the health mode (P2-C01)', async () => {
    renderPanel(makeClient());

    const first = await screen.findByRole('checkbox', { name: /B1/ });
    await waitFor(() => {
      expect(first).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /B2/ })).toBeChecked();
      expect(screen.queryByRole('checkbox', { name: /A1/ })).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/offline/)).toBeInTheDocument();
  });

  it('posts exactly the selected scenarios and navigates to the run (P2-C01)', async () => {
    const client = makeClient();
    renderPanel(client);

    fireEvent.click(await screen.findByRole('checkbox', { name: /B1/ }));
    fireEvent.click(screen.getByRole('button', { name: /Diagnose/i }));

    await waitFor(() =>
      expect(client.createRun).toHaveBeenCalledWith({
        target: 'store',
        mode: 'offline',
        scenarios: ['B2'],
      }),
    );
    expect(await screen.findByText('Run page reached')).toBeInTheDocument();
  });

  it('disables the Diagnose button while posting (P2-C01)', async () => {
    let resume: (response: RunCreateResponse) => void = () => {};
    const createRun = vi.fn(() => new Promise<RunCreateResponse>((resolve) => (resume = resolve)));
    renderPanel(makeClient({ createRun }));

    fireEvent.click(await screen.findByRole('button', { name: /Diagnose/i }));
    expect(screen.getByRole('button', { name: /Diagnose/i })).toBeDisabled();

    resume({ runId: 'run-new' });
    await screen.findByText('Run page reached');
  });

  it('shows the API error text when creating the run fails (P2-C01)', async () => {
    const client = makeClient({
      createRun: vi.fn(async () => {
        throw new Error('buying is offline');
      }),
    });
    renderPanel(client);

    fireEvent.click(await screen.findByRole('button', { name: /Diagnose/i }));

    expect(await screen.findByText(/buying is offline/i)).toBeInTheDocument();
    expect(screen.queryByText('Run page reached')).not.toBeInTheDocument();
  });
});
