// Observe only OSC title signals. The caller continues forwarding the original PTY data.
export function observeTitles(publish: (title: string) => void) {
  let state: 'text' | 'escape' | 'command' | 'title' | 'ignore' = 'text';
  let command = '', title = '', ending = false;
  const finish = () => {
    if (state === 'title') publish(title);
    state = 'text'; title = '';
  };
  return (chunk: string) => {
    for (const character of chunk) {
      if (ending) {
        ending = false;
        if (character === '\\') { finish(); continue; }
        // A different escape abandons the incomplete OSC and begins the next sequence.
        state = 'escape'; title = '';
      }
      if (character === '\x1b') {
        if (state === 'title' || state === 'ignore') ending = true;
        else state = 'escape';
        continue;
      }
      if (character === '\x9d') { state = 'command'; command = ''; continue; }
      if (state === 'text') continue;
      if (state === 'escape') { state = character === ']' ? 'command' : 'text'; command = ''; }
      else if (state === 'command') {
        if (character === ';') { state = command === '0' || command === '2' ? 'title' : 'ignore'; title = ''; }
        else if (/\d/.test(character) && command.length < 3) command += character;
        else state = 'text';
      } else if (character === '\x07' || character === '\x9c') finish();
      else if (state === 'title') title += character;
    }
  };
}
