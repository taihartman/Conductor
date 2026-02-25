import React, { useEffect } from 'react';
import { ConductorDashboard } from './components/ConductorDashboard';
import { useVsCodeMessage } from './hooks/useVsCodeMessage';
import { vscode } from './vscode';

export function App(): React.ReactElement {
  useVsCodeMessage();

  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
  }, []);

  return <ConductorDashboard />;
}
