import { createRoot } from 'react-dom/client';
import App from './App.prototype';
import { model } from './model.prototype';
import './style.prototype.css';

if (location.pathname === '/') history.replaceState(null, '', `/prototype/workbench${location.search}`);
if (new URLSearchParams(location.search).get('scene') === 'empty') model.seedPanels(0);
createRoot(document.getElementById('root')!).render(<App />);
