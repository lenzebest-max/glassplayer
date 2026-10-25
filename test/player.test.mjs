import test from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../renderer/js/util.js';
import { Player } from '../renderer/js/player.js';

const presence = [];
globalThis.glass = { discord: { nowPlaying: async (np) => { presence.push(np); } } };

class FakeProvider extends Emitter {
  constructor(id, catalog = {}) {
    super();
    this.id = id;
    this.connected = true;
    this.catalog = catalog; // isrc -> ref
    this.played = [];
  }
  async findByIsrc(isrc) { return this.catalog[isrc] ? [{ title: 'x', artist: 'y', refs: { [this.id]: this.catalog[isrc] } }] : []; }
  async findByText() { return []; }
  async play(t) { this.played.push(t.refs[this.id]); }
  async position() { return null; }
  pause() {} resume() {} seek() {} stop() {} setVolume() {}
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const make = (settings = { preferredService: 'auto', volume: 0.5 }) => {
  const spotify = new FakeProvider('spotify', { ISRC2: 'spotify:track:2' });
  const apple = new FakeProvider('apple', { ISRC1: 'a1' });
  const player = new Player({ spotify, apple }, () => settings);
  return { spotify, apple, player };
};

test('auto mode plays each track on its own service and advances on end', async () => {
  const { spotify, apple, player } = make();
  const tracks = [
    { title: 'One', artist: 'A', refs: { spotify: 'spotify:track:1' } },
    { title: 'Two', artist: 'B', refs: { apple: 'a2' } },
  ];
  await player.setQueue(tracks, 0);
  assert.deepEqual(spotify.played, ['spotify:track:1']);
  assert.equal(player.engine, spotify);
  spotify.emit('ended');
  await tick();
  assert.deepEqual(apple.played, ['a2']);
  assert.equal(player.track, tracks[1]);
  assert.equal(presence.at(-1).title, 'Two');
  player.destroy();
});

test('preferring Apple matches a Spotify-only track by ISRC and caches it', async () => {
  const { spotify, apple, player } = make({ preferredService: 'apple', volume: 0.5 });
  const t = { title: 'S', artist: 'A', isrc: 'ISRC1', refs: { spotify: 'spotify:track:9' } };
  await player.setQueue([t], 0);
  assert.deepEqual(apple.played, ['a1']);
  assert.equal(t.refs.apple, 'a1');
  assert.equal(spotify.played.length, 0);
  player.destroy();
});

test('falls back to the other service, then skips unplayable tracks', async () => {
  const { spotify, apple, player } = make({ preferredService: 'apple', volume: 0.5 });
  const errors = [];
  player.on('error', (e) => errors.push(e.message));
  const tracks = [
    { title: 'Nowhere', artist: 'X', refs: {} },
    { title: 'Two', artist: 'B', isrc: 'ISRC2', refs: {} },
  ];
  await player.setQueue(tracks, 0);
  assert.match(errors[0], /Couldn't find/);
  await new Promise((r) => setTimeout(r, 900));
  assert.deepEqual(spotify.played, ['spotify:track:2']);
  assert.equal(apple.played.length, 0);
  player.destroy();
});

test('repeat one replays, repeat all wraps, shuffle keeps current first', async () => {
  const { spotify, player } = make();
  const tracks = [1, 2, 3].map((n) => ({ title: `T${n}`, artist: 'A', refs: { spotify: `spotify:track:${n}` } }));
  await player.setQueue(tracks, 2);
  player.cycleRepeat(); // all
  player.cycleRepeat(); // one
  spotify.emit('ended');
  await tick();
  assert.deepEqual(spotify.played, ['spotify:track:3', 'spotify:track:3']);
  player.cycleRepeat(); // off
  player.cycleRepeat(); // all
  spotify.emit('ended');
  await tick();
  assert.equal(spotify.played.at(-1), 'spotify:track:1');
  player.toggleShuffle();
  assert.equal(player.queue[player.order[player.pos]], tracks[0]);
  assert.equal(new Set(player.order).size, 3);
  player.destroy();
});
