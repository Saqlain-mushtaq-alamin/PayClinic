import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Step } from '@payclinic/contracts';
import '../test-setup';
import { TraceTimeline } from './TraceTimeline';

function step(over: Partial<Step>): Step {
  return {
    id: 's',
    runId: 'run-1',
    scenarioId: 'run-1-scn-B1',
    seq: 0,
    actor: 'runner',
    method: 'POST',
    url: 'http://127.0.0.1:50002/api/orders',
    requestHeaders: {},
    requestBody: { cartId: 'cart-1' },
    responseStatus: 201,
    responseHeaders: {},
    responseBody: { orderId: 'ORD0001' },
    durationMs: 5,
    timestamp: '2026-10-18T10:00:00.000Z',
    ...over,
  };
}

describe('TraceTimeline', () => {
  it('highlights exactly the evidence steps via aria-current (P2-C02)', () => {
    const steps = [
      step({ id: 's-b', seq: 1, label: 'cheese', actor: 'store' }),
      step({ id: 's-a', seq: 0, label: 'boots', actor: 'runner' }),
      step({ id: 's-c', seq: 2, label: 'dash', actor: 'store', responseStatus: 500 }),
    ];
    const { container } = render(<TraceTimeline steps={steps} evidenceStepIds={['s-a', 's-c']} />);

    const highlighted = container.querySelectorAll('[aria-current="true"]');
    expect(highlighted).toHaveLength(2);
    expect(highlighted[0]).toHaveTextContent('boots');
    expect(highlighted[1]).toHaveTextContent('dash');

    const rows = screen.getAllByTestId('timeline-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('boots');
    expect(rows[1]).toHaveTextContent('cheese');
    expect(rows[2]).toHaveTextContent('dash');
  });

  it('expands a row to show the response JSON and shows the debug id chip (P2-C02)', () => {
    const steps = [
      step({ id: 'paypal', seq: 1, label: 'cheese', actor: 'store', paypalDebugId: 'dbg-1' }),
    ];
    render(<TraceTimeline steps={steps} evidenceStepIds={['paypal']} />);

    expect(screen.queryByText(/ORD0001/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cheese/ }));

    expect(screen.getByRole('button', { name: /cheese/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/ORD0001/)).toBeInTheDocument();
    expect(screen.getByText('dbg-1')).toBeInTheDocument();
  });
});
