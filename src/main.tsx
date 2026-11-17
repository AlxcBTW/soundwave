import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyDisplayMode } from './game/displayMode';
import { loadSettings } from './game/settings';
import { App } from './ui/App';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/archivo/wdth-italic.css';
import './ui/styles.css';

// The desktop window starts hidden; this puts it in the stored display mode and shows it.
void applyDisplayMode(loadSettings().displayMode);

const root = document.getElementById('root')!;
if (import.meta.env.DEV && location.hash.startsWith('#stage')) {
  void import('./debug/StagePreview').then((m) => m.runStagePreview(root));
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
