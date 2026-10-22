import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Layout } from './Layout';
import { Spinner } from './Spinner';
import { ScoreGauge } from '../ScoreGauge';
import '../../test-setup';

describe('Badge', () => {
  it('renders its text and a tone class', () => {
    render(<Badge tone="critical">Critical</Badge>);
    const badge = screen.getByText('Critical');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge', 'badge--critical');
  });
});

describe('Button', () => {
  it('calls its handler when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Retry</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Card', () => {
  it('renders its children', () => {
    render(
      <Card>
        <p>Card body</p>
      </Card>,
    );
    expect(screen.getByText('Card body')).toBeInTheDocument();
  });
});

describe('Spinner', () => {
  it('exposes a status role and a label', () => {
    render(<Spinner label="Loading runs..." />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading runs...');
  });
});

describe('EmptyState', () => {
  it('renders its message', () => {
    render(<EmptyState message="No runs yet" />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders its message and calls the retry handler', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Something broke" onRetry={onRetry} />);
    expect(screen.getByText('Something broke')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ScoreGauge', () => {
  it('exposes an accessible label with the score', () => {
    render(<ScoreGauge score={70} scoreBefore={70} scoreAfter={100} />);
    expect(
      screen.getByRole('img', { name: 'Payment Safety Score 70 out of 100' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('score-gauge')).toHaveTextContent('70');
    expect(screen.getByTestId('score-gauge')).toHaveTextContent('100');
  });
});

describe('Layout', () => {
  it('shows the brand, stages and health mode', async () => {
    render(
      <MemoryRouter>
        <Layout
          client={{
            health: async () => ({
              ok: true,
              mode: 'offline',
              version: 'test',
              aiProvider: 'fixture',
            }),
          }}
        >
          <p>Page content</p>
        </Layout>
      </MemoryRouter>,
    );
    expect(screen.getByText('PayClinic')).toBeInTheDocument();
    expect(screen.getByText(/Diagnose · Prescribe · Protect/)).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});
