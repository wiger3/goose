import { useEffect, useRef, useState } from 'react';
import BackendSetup from './BackendSetup';

interface BackendGateProps {
  children: React.ReactNode;
}

// Startup connection attempts. The very first probe after launch often loses a
// few rounds — the OS may still be bringing up networking, and Electron's
// network service is cold — while the same request succeeds a moment later.
// Without this, a configured-but-not-yet-reachable backend drops straight to
// the setup screen even though clicking "Connect" would work immediately.
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

// Retrying these is pointless: the request reached the server and was refused.
const PERMANENT_FAILURE = /certificate|pin|secret key/i;

/**
 * Mounts the app only when the window has a backend attached. Everything below
 * this point talks to ACP, so the setup screen has to sit above the providers
 * that would otherwise fail with "ACP URL is not available".
 */
export default function BackendGate({ children }: BackendGateProps) {
  const [state, setState] = useState<'checking' | 'connecting' | 'ready' | 'missing'>('checking');
  const [startupError, setStartupError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [targetUrl, setTargetUrl] = useState('');
  const stopRetry = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const stopped = () => cancelled || stopRetry.current;

    (async () => {
      try {
        const [acpUrl, backendError] = await Promise.all([
          window.electron.getAcpUrl(),
          window.electron.getBackendError(),
        ]);
        if (stopped()) {
          return;
        }
        if (acpUrl) {
          setState('ready');
          return;
        }

        let config: { enabled?: boolean; url?: string } | null = null;
        try {
          config = await window.electron.getSetting('externalGoosed');
        } catch (readError) {
          console.error('Failed to read external backend settings:', readError);
        }

        if (!config?.enabled || !config.url) {
          setStartupError(backendError ?? null);
          setState('missing');
          return;
        }

        setTargetUrl(config.url);
        setState('connecting');
        let lastError = backendError ?? null;

        for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[index]));
          if (stopped()) {
            return;
          }
          setAttempt(index + 1);

          const result = await window.electron.backendConnect();
          if (stopped()) {
            return;
          }
          if (result?.ok) {
            window.location.reload();
            return;
          }

          lastError = result?.error ?? lastError;
          if (lastError && PERMANENT_FAILURE.test(lastError)) {
            break;
          }
        }

        setStartupError(lastError);
        setState('missing');
      } catch (error) {
        if (stopped()) {
          return;
        }
        setStartupError(error instanceof Error ? error.message : String(error));
        setState('missing');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'ready') {
    return <>{children}</>;
  }

  if (state === 'checking') {
    return null;
  }

  if (state === 'connecting') {
    return (
      <div className="h-screen w-full bg-background-default flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-light mb-2">Connecting to backend…</h1>
          <p className="text-text-muted text-sm font-mono break-all">{targetUrl}</p>
          <p className="text-text-muted text-xs mt-3">
            attempt {attempt} of {RETRY_DELAYS_MS.length}
          </p>
          <button
            type="button"
            className="mt-6 text-sm underline underline-offset-4 text-text-muted hover:text-text-default"
            onClick={() => {
              stopRetry.current = true;
              setStartupError('Stopped retrying — configure the backend below.');
              setState('missing');
            }}
          >
            Set it up manually
          </button>
        </div>
      </div>
    );
  }

  return <BackendSetup startupError={startupError} />;
}
