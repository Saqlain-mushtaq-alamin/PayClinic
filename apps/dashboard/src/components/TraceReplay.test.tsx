import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Step } from '@payclinic/contracts';
import '../test-setup';
import { TraceReplay } from './TraceReplay';

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

const steps = [
  step({ id: 's1', seq: 0, label: 'create cart' }),
  step({ id: 's2', seq: 1, label: 'create order', responseStatus: 500 }),
  step({ id: 's3', seq: 2, label: 'capture' }),
];

describe('TraceReplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows steps progressively while playing and the verdict on the last step', () => {
    render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="Cart was captured twice." />);

    expect(screen.queryByTestId('timeline-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('replay-verdict')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(3);
    expect(screen.getByTestId('replay-verdict')).toHaveTextContent('Cart was captured twice.');
  });

  it('pause stops the progression', () => {
    render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="done" />);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);
  });

  it('shows the evidence marker when the evidence step is reached', () => {
    const { container } = render(
      <TraceReplay steps={steps} evidenceStepIds={['s2']} verdict="done" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1000));
    const marked = container.querySelectorAll('[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('create order');
  });

  it('restart returns to the beginning and replays', () => {
    render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="done" />);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    expect(screen.queryByTestId('timeline-row')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);
  });

  it('speed selector changes the pace', () => {
    render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="done" />);

    fireEvent.change(screen.getByTestId('replay-speed'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('timeline-row')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);
  });

  it('space toggles play and arrow right steps while paused', () => {
    render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="done" />);
    const root = screen.getByTestId('replay-root');

    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);

    fireEvent.keyDown(root, { key: ' ' });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(2);

    fireEvent.keyDown(root, { key: ' ' });
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(2);
  });

  it('does not hijack space when an inner element is focused', () => {
    render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="done" />);
    const stepButton = screen.getByRole('button', { name: 'Step' });

    // Firing space on an inner button bubbles up, but event.target !== event.currentTarget
    fireEvent.keyDown(stepButton, { key: ' ' });
    act(() => vi.advanceTimersByTime(1000));
    // Since play was not toggled, no new rows are advanced by interval timer
    expect(screen.queryByTestId('timeline-row')).not.toBeInTheDocument();
  });

  it('scrolls the current row into view without animation under reduced motion', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    try {
      render(<TraceReplay steps={steps} evidenceStepIds={[]} verdict="done" />);
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
      act(() => vi.advanceTimersByTime(1000));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest' });
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
