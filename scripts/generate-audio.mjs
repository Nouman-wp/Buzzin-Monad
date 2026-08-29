/**
 * Generates the bundled Songless clip set.
 *
 * Every clip is synthesised from scratch here — a plucked "music box" timbre
 * rendered from note lists for melodies that are unambiguously public domain.
 * Nothing is downloaded, nothing is licensed, and the output is deterministic,
 * so the demo can never be blocked by a third-party music API.
 *
 * Output: public/audio/track-XX.wav (16-bit PCM mono, 16 kHz).
 * Filenames are intentionally opaque so they never leak the answer.
 *
 * Run: npm run gen:audio
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'audio');

const SAMPLE_RATE = 16000;
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" / "F#5" / "Bb3" -> frequency in Hz (A4 = 440). */
function noteToFreq(note) {
  if (note === 'R') return 0;
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!match) throw new Error(`Bad note: ${note}`);
  const [, letter, accidental, octaveText] = match;
  let semitone = SEMITONES[letter];
  if (accidental === '#') semitone += 1;
  if (accidental === 'b') semitone -= 1;
  const midi = (Number(octaveText) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Plucked tone: three decaying partials with a short attack. Cheap to compute
 * and clearly pitched, which is all the game needs.
 */
function renderNote(buffer, startSample, durationSec, freq, gain) {
  if (freq === 0) return;
  const total = Math.floor(durationSec * SAMPLE_RATE);
  const attack = Math.floor(0.006 * SAMPLE_RATE);
  for (let i = 0; i < total; i += 1) {
    const index = startSample + i;
    if (index >= buffer.length) break;
    const t = i / SAMPLE_RATE;
    const envelope =
      (i < attack ? i / attack : 1) * Math.exp(-3.1 * t) * (1 - i / total) ** 0.35;
    const sample =
      Math.sin(2 * Math.PI * freq * t) * 1.0 +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.32 * Math.exp(-6 * t) +
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.12 * Math.exp(-9 * t);
    buffer[index] += sample * envelope * gain;
  }
}

function renderMelody(notes, beatSec) {
  const totalBeats = notes.reduce((sum, [, beats]) => sum + beats, 0);
  const lengthSec = totalBeats * beatSec + 0.9;
  const buffer = new Float32Array(Math.ceil(lengthSec * SAMPLE_RATE));

  let cursorBeats = 0;
  for (const [note, beats] of notes) {
    const start = Math.floor(cursorBeats * beatSec * SAMPLE_RATE);
    const freq = noteToFreq(note);
    // Let notes ring slightly past their slot for a more musical result.
    renderNote(buffer, start, beats * beatSec + 0.5, freq, 0.5);
    if (freq > 0) renderNote(buffer, start, beats * beatSec + 0.6, freq / 2, 0.18);
    cursorBeats += beats;
  }

  // Normalise then apply a short fade-in/out so clips never click.
  let peak = 0;
  for (const value of buffer) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0 ? 0.86 / peak : 0;
  const fade = Math.floor(0.05 * SAMPLE_RATE);
  for (let i = 0; i < buffer.length; i += 1) {
    let value = buffer[i] * scale;
    if (i < fade) value *= i / fade;
    const tail = buffer.length - i;
    if (tail < fade) value *= tail / fade;
    buffer[i] = value;
  }
  return buffer;
}

function toWav(samples) {
  const dataLength = samples.length * 2;
  const output = Buffer.alloc(44 + dataLength);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + dataLength, 4);
  output.write('WAVE', 8);
  output.write('fmt ', 12);
  output.writeUInt32LE(16, 16); // PCM chunk size
  output.writeUInt16LE(1, 20); // format = PCM
  output.writeUInt16LE(1, 22); // channels
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  output.writeUInt16LE(2, 32); // block align
  output.writeUInt16LE(16, 34); // bits per sample
  output.write('data', 36);
  output.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    output.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return output;
}

const n = (spec) =>
  spec
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [note, beats] = token.split(':');
      return [note, beats ? Number(beats) : 1];
    });

/** All melodies below are traditional or long-expired copyright. */
export const TRACKS = [
  {
    file: 'track-01.wav',
    beat: 0.36,
    notes: n(`E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2`),
  },
  {
    file: 'track-02.wav',
    beat: 0.22,
    notes: n(`E5 D#5 E5 D#5 E5 B4 D5 C5 A4:2 R:0.5 C4 E4 A4 B4:2 R:0.5 E4 G#4 B4 C5:2`),
  },
  {
    file: 'track-03.wav',
    beat: 0.34,
    notes: n(`C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2`),
  },
  {
    file: 'track-04.wav',
    beat: 0.3,
    notes: n(`A4:1 C5:1 D5:1.5 E5:0.5 F5:1 E5:1 D5:1.5 B4:0.5 G4:1 A4:1 B4:1.5 C5:0.5 A4:2 A4:1 G#4:1 A4:2`),
  },
  {
    file: 'track-05.wav',
    beat: 0.4,
    notes: n(`F#5 E5 D5 C#5 B4 A4 B4 C#5 D5 C#5 B4 A4 G4 F#4 G4 E4`),
  },
  {
    file: 'track-06.wav',
    beat: 0.16,
    notes: n(`E4 E4 E4:0.5 E4 E4 E4:0.5 E4 E4 G4 C5:1.5 G4:0.5 E4:2 E4 E4 E4:0.5 E4 E4 E4:0.5 E4 E4 G4 C5:1.5 G4:0.5 E4:2`),
  },
  {
    file: 'track-07.wav',
    beat: 0.19,
    notes: n(`B3 C#4 D4 E4 F#4 D4 F#4:2 F4 C#4 F4 E4:2 B3 C#4 D4 E4 F#4 D4 F#4:2 A4 G4 F#4 E4:2`),
  },
  {
    file: 'track-08.wav',
    beat: 0.24,
    notes: n(`G4:1 D4:1 G4:0.5 D4:0.5 G4:0.5 D4:0.5 G4 B4 D5:2 R:0.5 C5:1 A4:1 C5:0.5 A4:0.5 C5:0.5 A4:0.5 C5 E5 A5:2`),
  },
  {
    file: 'track-09.wav',
    beat: 0.28,
    notes: n(`D4:1 G4:2 B4:2 R:0.5 B4:1 B4:1 R:0.5 D5:1 G4:2 B4:2 R:0.5 B4:1 B4:1`),
  },
  {
    file: 'track-10.wav',
    beat: 0.19,
    notes: n(`E4 E4 E4:2 E4 E4 E4:2 E4 G4 C4:1.5 D4:0.5 E4:3 F4 F4 F4:1.5 F4:0.5 F4 E4 E4 E4 E4 D4 D4 E4 D4:2 G4:2`),
  },
  {
    file: 'track-11.wav',
    beat: 0.3,
    notes: n(`C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:2 E4 F4 G4:2`),
  },
  {
    file: 'track-12.wav',
    beat: 0.31,
    notes: n(`G3:1 C4:2 E4:0.5 C4:0.5 E4:2 D4:1 C4:2 A3:1 G3:3 G3:1 C4:2 E4:0.5 C4:0.5 E4:2 D4:2`),
  },
];

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const track of TRACKS) {
    const samples = renderMelody(track.notes, track.beat);
    const wav = toWav(samples);
    writeFileSync(join(OUT_DIR, track.file), wav);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(1);
    console.log(`wrote ${track.file}  ${seconds}s  ${(wav.length / 1024).toFixed(0)}KB`);
  }
  console.log(`\n${TRACKS.length} clips written to public/audio`);
}

main();
