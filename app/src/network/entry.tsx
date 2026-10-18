import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import NetworkApp from './NetworkApp';
import './preview.css';
createRoot(document.getElementById('root')!).render(<StrictMode><NetworkApp /></StrictMode>);
