import { useEffect, useState } from 'react';
import BackendSetup from './BackendSetup';

interface BackendGateProps {
  children: React.ReactNode;
}

/**
 * Mounts the app only when the window has a backend attached. Everything below
 * this point talks to ACP, so the setup screen has to sit above the providers
 * that would otherwise fail with "ACP URL is not available".
 */
export default function BackendGate({ children }: BackendGateProps) {
  const [state, setState] = useState<'checking' | 'ready' | 'missing'>('checking');
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [acpUrl, backendError] = await Promise.all([
          window.electron.getAcpUrl(),
          window.electron.getBackendError(),
        ]);
        setStartupError(backendError ?? null);
        setState(acpUrl ? 'ready' : 'missing');
      } catch (error) {
        setStartupError(error instanceof Error ? error.message : String(error));
        setState('missing');
      }
    })();
  }, []);

  if (state === 'ready') {
    return <>{children}</>;
  }

  if (state === 'checking') {
    return null;
  }

  return <BackendSetup startupError={startupError} />;
}
