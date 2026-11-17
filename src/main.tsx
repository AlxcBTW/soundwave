import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/archivo/wdth-italic.css';
import './ui/styles.css';

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
