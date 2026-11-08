import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell';
import { DashboardProvider, useDashboard } from '../../context/DashboardContext';
import '../../test-setup';

function SearchConsumer() {
  const { searchQuery } = useDashboard();
  return <div data-testid="search-consumer">{searchQuery}</div>;
}

describe('Shell', () => {
  it('renders sidebar + topbar', async () => {
    render(
      <MemoryRouter>
        <DashboardProvider>
          <Shell
            client={{
              health: async () => ({
                ok: true,
                mode: 'offline',
                version: 'test',
                aiProvider: 'fixture',
              }),
            }}
          >
            <p>Main content area</p>
          </Shell>
        </DashboardProvider>
      </MemoryRouter>,
    );

    // Sidebar
    expect(screen.getByLabelText('Sidebar')).toBeInTheDocument();
    expect(screen.getByLabelText('PayClinic Home')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runs & Findings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Live Activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();

    // Topbar
    expect(screen.getByTestId('search-input')).toBeInTheDocument();
    expect(screen.getByTestId('mode-badge')).toBeInTheDocument();
    expect(screen.getByTestId('live-indicator')).toBeInTheDocument();
    expect(screen.getByLabelText('User profile')).toBeInTheDocument();

    // Content
    expect(screen.getByText('Main content area')).toBeInTheDocument();
  });

  it('search input updates context or URL', async () => {
    render(
      <MemoryRouter initialEntries={['/?q=initial']}>
        <DashboardProvider>
          <Shell>
            <SearchConsumer />
          </Shell>
        </DashboardProvider>
      </MemoryRouter>,
    );

    const input = screen.getByTestId('search-input') as HTMLInputElement;
    expect(input.value).toBe('initial');
    expect(screen.getByTestId('search-consumer')).toHaveTextContent('initial');

    fireEvent.change(input, { target: { value: 'finding-123' } });
    expect(input.value).toBe('finding-123');
    expect(screen.getByTestId('search-consumer')).toHaveTextContent('finding-123');
  });

  it('mode badge reflects health endpoint', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <DashboardProvider>
          <Shell
            client={{
              health: async () => ({
                ok: true,
                mode: 'offline',
                version: 'test',
                aiProvider: 'fixture',
              }),
            }}
          >
            <p>Content</p>
          </Shell>
        </DashboardProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Offline demo')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <DashboardProvider>
          <Shell
            client={{
              health: async () => ({
                ok: true,
                mode: 'online',
                version: 'test',
                aiProvider: 'fixture',
              }),
            }}
          >
            <p>Content</p>
          </Shell>
        </DashboardProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Live sandbox')).toBeInTheDocument();
  });
});
