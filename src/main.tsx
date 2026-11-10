import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Note from './Note';
import './note-view.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Note />
  </StrictMode>,
);
