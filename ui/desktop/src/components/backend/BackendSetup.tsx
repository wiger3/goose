import { useEffect, useState } from 'react';
import { normalizeAcpHttpBaseUrl } from '../../acp/url';
import { ExternalBackendConfig } from '../../utils/settings';
import { defineMessages, useIntl } from '../../i18n';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Goose } from '../icons';

const i18n = defineMessages({
  title: {
    id: 'externalBackendSection.title',
    defaultMessage: 'External Backend (ACP)',
  },
  serverUrl: {
    id: 'externalBackendSection.serverUrl',
    defaultMessage: 'Backend Base URL',
  },
  serverUrlHelp: {
    id: 'externalBackendSection.serverUrlHelp',
    defaultMessage:
      'Enter the HTTP(S) base URL. Goose checks /status and connects to /acp under this base.',
  },
  secretKey: {
    id: 'externalBackendSection.secretKey',
    defaultMessage: 'Secret Key',
  },
  secretKeyHelp: {
    id: 'externalBackendSection.secretKeyHelp',
    defaultMessage:
      'The secret key configured on the external backend (GOOSE_SERVER__SECRET_KEY).',
  },
  secretKeyPlaceholder: {
    id: 'externalBackendSection.secretKeyPlaceholder',
    defaultMessage: "Enter the server's secret key",
  },
});

interface BackendSetupProps {
  startupError: string | null;
}

/**
 * Shown when the desktop has no working backend: either none is configured or
 * the configured one could not be reached. Replaces the chat UI entirely so the
 * app never depends on a bundled CLI to start.
 */
export default function BackendSetup({ startupError }: BackendSetupProps) {
  const intl = useIntl();
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [existing, setExisting] = useState<ExternalBackendConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const config = await window.electron.getSetting('externalGoosed');
        setExisting(config ?? null);
        setUrl(config?.url ?? '');
        setSecret(config?.secret ?? '');
      } catch (readError) {
        console.error('Failed to read external backend settings:', readError);
      }
    })();
  }, []);

  const connect = async () => {
    setError(null);

    let baseUrl: string;
    try {
      baseUrl = normalizeAcpHttpBaseUrl(url);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : String(validationError));
      return;
    }

    setBusy(true);
    try {
      await window.electron.setSetting('externalGoosed', {
        ...(existing ?? { enabled: false, url: '', secret: '' }),
        enabled: true,
        url: baseUrl,
        secret: secret.trim(),
      });

      const result = await window.electron.backendConnect();
      if (!result?.ok) {
        setError(result?.error ?? 'Could not reach the backend.');
        return;
      }

      window.location.reload();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError));
    } finally {
      setBusy(false);
    }
  };

  const failure = error ?? startupError;

  return (
    <div className="h-screen w-full bg-background-default flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full">
        <div className="mb-6">
          <Goose className="size-8 mb-4" />
          <h1 className="text-xl font-light mb-2">{intl.formatMessage(i18n.title)}</h1>
          <p className="text-text-muted text-sm">
            This build has no local backend. Point it at a running{' '}
            <code className="font-mono">goose serve</code> instance to continue.
          </p>
        </div>

        {failure && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950 p-3">
            <p className="text-xs font-mono text-red-800 dark:text-red-200 break-words">{failure}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1" htmlFor="backend-setup-url">
              {intl.formatMessage(i18n.serverUrl)}
            </label>
            <Input
              id="backend-setup-url"
              value={url}
              placeholder="https://10.0.0.5:3000"
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-text-muted mt-1">{intl.formatMessage(i18n.serverUrlHelp)}</p>
          </div>

          <div>
            <label className="block text-sm mb-1" htmlFor="backend-setup-secret">
              {intl.formatMessage(i18n.secretKey)}
            </label>
            <Input
              id="backend-setup-secret"
              type="password"
              value={secret}
              placeholder={intl.formatMessage(i18n.secretKeyPlaceholder)}
              onChange={(event) => setSecret(event.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-text-muted mt-1">{intl.formatMessage(i18n.secretKeyHelp)}</p>
          </div>

          <Button onClick={connect} disabled={busy || !url.trim()}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </div>
  );
}
