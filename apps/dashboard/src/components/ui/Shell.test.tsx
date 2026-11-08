import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell';
import { DashboardProvider } from '../../context/DashboardContext';
import '../../test-setup';

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
    expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();

    // Topbar
    expect(screen.getByText('PayClinic')).toBeInTheDocument();
    expect(screen.getByTestId('mode-badge')).toBeInTheDocument();
    expect(screen.getByTestId('live-indicator')).toBeInTheDocument();
    expect(screen.getByLabelText('User profile')).toBeInTheDocument();

    // Content
    expect(screen.getByText('Main content area')).toBeInTheDocument();
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
