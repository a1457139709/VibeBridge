import { createRoot } from 'react-dom/client';
import { Workbench } from './Workbench';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './terminal.css';
import './processing-status.css';
import './project-summary.css';
import './panel-tray.css';
import './project-navigation.css';

createRoot(document.getElementById('root')!).render(<Workbench />);
