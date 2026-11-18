import { createRoot } from 'react-dom/client';
import { App } from './Workbench';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './panels/agent-panel.css';
import './settings/settings-page.css';
import './panels/terminal.css';
import './common/processing-status.css';
import './workspace/project-summary.css';
import './workspace/panel-tray.css';
import './projects/project-navigation.css';

createRoot(document.getElementById('root')!).render(<App />);
