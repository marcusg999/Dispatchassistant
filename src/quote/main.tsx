/** Client quote page (/q/:token). Sessionless; talks only to /api/quote/*. No storage of any kind. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:brand.css';
import './quote.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
