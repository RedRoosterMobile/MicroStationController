// microSTATION composer: wires the modules together.
import { initChannels } from './composer/channels.js';
import { connect, initConnection } from './composer/connection.js';
import { initDiagnostics } from './composer/diagnostics.js';
import { initMidiExport } from './composer/midiexport.js';
import { initPlayer, updateButtons } from './composer/player.js';
import { initRouting } from './composer/routing.js';
import { initSong, loadSavedSong, onDrumChannelChange } from './composer/song.js';
import { initTracks } from './composer/tracks.js';

initChannels(onDrumChannelChange);
initRouting();
initDiagnostics();
initTracks();
initPlayer();
initSong();
initMidiExport();
initConnection();

updateButtons();
loadSavedSong();
connect();
