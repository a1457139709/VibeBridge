import { createRoot } from 'react-dom/client';
import { App } from './Workbench';
import { requireValue } from './common/required';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './panels/agent-panel.css';
import './settings/settings-page.css';
import './panels/terminal.css';
import './common/processing-status.css';
import './workspace/project-summary.css';
import './workspace/panel-tray.css';
import './projects/project-navigation.css';

createRoot(requireValue(document.getElementById('root'), 'the #root element')).render(<App />);
