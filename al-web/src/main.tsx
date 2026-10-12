import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useRoutes } from 'react-router';
import { appRoutes } from './routes';
import './styles.css';

function App() {
  return useRoutes(appRoutes);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
