// Shared state of the composer page: the loaded song, plus change notification the track list subscribes to.
import { store } from '../lib/store.js';

export const composer = { song: null };

const listeners = [];
export const onTracksChange = fn => listeners.push(fn);
export const notifyTracksChange = () => listeners.forEach(fn => fn());

export const saveSong = () => composer.song && store.set('comp.song', composer.song);

// Muted tracks are silent; when any track is soloed only soloed tracks sound.
export const audible = t => !t.muted && (!composer.song.tracks.some(x => x.solo) || t.solo);
