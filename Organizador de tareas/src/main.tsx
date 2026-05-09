import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './AppOperationalFix.tsx';
import './index.css';

if (window.location.hostname === '127.0.0.1') {
  window.location.replace(`http://localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
