import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsResponse } from '@payclinic/contracts';
import { ApiError, getAdminToken, type ApiClient } from '../api/client';
import { DashboardProvider } from '../context/DashboardContext';
import { SettingsPage } from './SettingsPage';
import '../test-setup';

const initialSettings: SettingsResponse = {
  paypalClientId: { configured: true, hint: '••••1234' },
  paypalClientSecret: { configured: true, hint: '••••5678' },
  aiProvider: { configured: true, hint: 'gemini' },
  geminiApiKey: { configured: true, hint: '••••abcd' },
  geminiModel: { configured: true, hint: 'gemini-2.5-flash' },
  githubToken: { configured: false, hint: '' },
  githubRepo: { configured: false, hint: '' },
  githubBaseBranch: { configured: false, hint: '' },
  mode: { configured: true, hint: 'offline' },
  publicUrl: { configured: true, hint: 'http://localhost:4000' },
  paypalVerifiedAt: { configured: false, hint: '' },
};

function createMockClient(overrides: Partial<ApiClient> = {}) {
  const settingsState = { ...initialSettings };
  return {
    getSettings: vi.fn(async () => settingsState),
    saveSettings: vi.fn(async (updates: Record<string, string | null>) => {
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) {
          settingsState[k] = { configured: false, hint: '' };
        } else if (v) {
          settingsState[k] = { configured: true, hint: v };
        }
      }
      return settingsState;
    }),
    testSetting: vi.fn(async (kind: string) => ({
      ok: true,
      message: `${kind} verified successfully`,
    })),
    getAuthStatus: vi.fn(async () => ({ required: false })),
    ...overrides,
  } as unknown as ApiClient;
}

const renderPage = (client: ApiClient) =>
  render(
    <MemoryRouter>
      <DashboardProvider>
        <SettingsPage client={client} />
      </DashboardProvider>
    </MemoryRouter>,
  );

describe('SettingsPage', () => {
  it('renders hints not secrets, and displays the sandbox banner', async () => {
    const client = createMockClient();
    renderPage(client);

    // Verify top banner
    expect(
      await screen.findByText(/Sandbox only\. PayClinic never uses live PayPal credentials\./i),
    ).toBeInTheDocument();

    // Verify masked placeholders render hints (not secrets)
    const paypalIdInput = screen.getByTestId('paypal-client-id') as HTMLInputElement;
    expect(paypalIdInput.placeholder).toBe('••••1234');

    const paypalSecretInput = screen.getByTestId('paypal-client-secret') as HTMLInputElement;
    expect(paypalSecretInput.placeholder).toBe('••••5678');

    const geminiKeyInput = screen.getByTestId('gemini-key-input') as HTMLInputElement;
    expect(geminiKeyInput.placeholder).toBe('••••abcd');

    // Values in inputs must start empty (not containing raw secrets)
    expect(paypalIdInput.value).toBe('');
    expect(paypalSecretInput.value).toBe('');
    expect(geminiKeyInput.value).toBe('');

    // Verify next steps link card to Projects
    expect(await screen.findAllByText(/Next: add your website in Projects/i)).toHaveLength(2);
    const link = screen.getByTestId('settings-to-projects-link');
    expect(link).toHaveAttribute('href', '/projects');
  });

  it('Save sends only changed fields', async () => {
    const client = createMockClient();
    renderPage(client);

    const paypalIdInput = await screen.findByTestId('paypal-client-id');
    fireEvent.change(paypalIdInput, { target: { value: 'fresh-client-id-999' } });

    // Click Save on PayPal card
    const saveButton = screen.getByTestId('save-paypal-button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(client.saveSettings).toHaveBeenCalledWith({
        paypalClientId: 'fresh-client-id-999',
      });
    });

    // Make sure paypalClientSecret was NOT sent because it was unchanged
    expect(client.saveSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ paypalClientSecret: expect.anything() }),
    );
  });

  it('online mode disabled until PayPal test is ok', async () => {
    const client = createMockClient({
      testSetting: vi.fn(async (kind: string) => {
        if (kind === 'paypal') {
          return { ok: true, message: 'PayPal sandbox credentials verified' };
        }
        return { ok: false, message: 'failed' };
      }),
    });
    renderPage(client);

    const onlineRadio = (await screen.findByTestId('mode-online-radio')) as HTMLInputElement;
    expect(onlineRadio).toBeDisabled();
    expect(screen.getByTestId('mode-disabled-hint')).toBeInTheDocument();

    // Click Test connection on PayPal card
    const testButton = screen.getByTestId('test-paypal-button');
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(client.testSetting).toHaveBeenCalledWith('paypal');
      expect(screen.getByTestId('paypal-test-result')).toHaveTextContent(
        'PayPal sandbox credentials verified',
      );
    });

    // Now online radio must be enabled
    expect(onlineRadio).not.toBeDisabled();
  });

  it('shows unlock dialog on 401 and stores admin token in memory', async () => {
    let callCount = 0;
    const client = createMockClient({
      getSettings: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new ApiError('unauthorized', 401);
        }
        return initialSettings;
      }),
    });

    renderPage(client);

    // Dialog appears
    const dialog = await screen.findByTestId('unlock-dialog');
    expect(dialog).toBeInTheDocument();

    const tokenInput = screen.getByTestId('admin-token-input');
    fireEvent.change(tokenInput, { target: { value: 'secret-admin-pass' } });

    const unlockButton = screen.getByTestId('unlock-submit-button');
    fireEvent.click(unlockButton);

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(getAdminToken()).toBe('secret-admin-pass');
    });
  });
});
