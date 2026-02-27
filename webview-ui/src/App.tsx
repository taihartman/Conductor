import React, { useEffect } from 'react';
import { ConductorDashboard } from './components/ConductorDashboard';
import { useVsCodeMessage } from './hooks/useVsCodeMessage';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { vscode } from './vscode';

export function App(): React.ReactElement {
  const navHandlers = useKeyboardNav();
  useVsCodeMessage(navHandlers);

  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
  }, []);

  return <ConductorDashboard />;
}
