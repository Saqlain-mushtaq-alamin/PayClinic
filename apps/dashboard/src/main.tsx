import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { DashboardProvider } from './context/DashboardContext';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const sync = () => {
  document.body.dataset.agThemeMode = mq.matches ? 'dark' : 'light';
};
sync();
mq.addEventListener('change', sync);

const container = document.getElementById('root');
if (!container) throw new Error('root element is missing');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <DashboardProvider>
        <App />
        <Toaster theme="dark" richColors position="bottom-right" />
      </DashboardProvider>
    </BrowserRouter>
  </StrictMode>,
);
