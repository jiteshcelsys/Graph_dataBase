import React from 'react';
import Dashboard from './pages/Dashboard';

// Global styles injected via JS (no separate CSS file needed)
const globalStyle = document.createElement('style');
globalStyle.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    background: #0a0a1e;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }
  details summary::-webkit-details-marker { display: none; }
  details summary::marker { display: none; }
  @media (max-width: 1200px) {
    .chart-grid { grid-template-columns: repeat(2, 1fr) !important; }
  }
  @media (max-width: 720px) {
    .chart-grid { grid-template-columns: 1fr !important; }
  }
  input:focus {
    border-color: rgba(102,126,234,0.6) !important;
    box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
`;
document.head.appendChild(globalStyle);

export default function App() {
  return <Dashboard />;
}
