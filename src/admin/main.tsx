import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from './theme';
import 'virtual:brand.css';
import 'virtual:brand-dark.css';
import './admin.css';
import { App } from './App';

// Before first render so there is no flash of the wrong theme.
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
