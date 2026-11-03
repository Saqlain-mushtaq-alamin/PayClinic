import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { FindingDetail } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import '../test-setup';
import { FindingPage } from './FindingPage';

const verified = mockData.findingDetails['fnd-run-2-1'] as unknown as FindingDetail;
const open = mockData.findingDetails['fnd-run-1-1'] as unknown as FindingDetail;

function renderPage(detail: FindingDetail): { container: HTMLElement } {
  return render(
    <MemoryRouter initialEntries={['/runs/run-2/findings/fnd-run-2-1']}>
      <Routes>
        <Route
          path="/runs/:id/findings/:fid"
          element={<FindingPage client={{ getFinding: async () => detail }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FindingPage', () => {
  it('shows the explanation, the diff and Verified for a verified finding (P2-C02)', async () => {
    const { container } = renderPage(verified);

    expect(
      await screen.findByRole('heading', { name: verified.finding.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(verified.finding.summary)).toBeInTheDocument();
    expect(screen.getByText(/root cause/i)).toBeInTheDocument();
    expect(container.querySelectorAll('.diff__line--del')).not.toHaveLength(0);
    expect(screen.getByText(/Verified/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prescribe/i })).not.toBeInTheDocument();
  });

  it('shows no diff and a dash for an open finding (P2-C02)', async () => {
    const { container } = renderPage(open);

    expect(await screen.findByRole('heading', { name: open.finding.title })).toBeInTheDocument();
    expect(screen.queryByTestId('diff')).not.toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
  });
});
