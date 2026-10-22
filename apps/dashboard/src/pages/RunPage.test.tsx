import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { RunDetail } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import { RunPage } from './RunPage';
import '../test-setup';

const detail = mockData.details['run-1'] as unknown as RunDetail;

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/runs/run-1']}>
      <Routes>
        <Route path="/runs/:id" element={<RunPage client={{ getRun: async () => detail }} />} />
      </Routes>
    </MemoryRouter>,
  );

describe('RunPage', () => {
  it('shows the score and mounts the findings grid', async () => {
    renderPage();
    expect(await screen.findByTestId('score-gauge')).toHaveTextContent('70');
    expect(screen.getByTestId('findings-grid')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /run-1/i })).toBeInTheDocument();
  });
});
