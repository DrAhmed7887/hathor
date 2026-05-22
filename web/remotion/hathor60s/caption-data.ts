/**
 * Burned-in captions for the 60s vertical short.
 *
 * Mirror of `video/hathor-60s-storyboard/captions.srt`. If the SRT is
 * re-timed against the locked VO waveform per render-notes.md, update this
 * array to match — the SRT remains the human source of truth.
 */

import { FPS } from "./tokens";

export type Cue = {
  fromFrame: number;
  toFrame: number;
  text: string;
};

const sec = (s: number) => Math.round(s * FPS);

export const CUES: Cue[] = [
  { fromFrame: sec(0),    toFrame: sec(4),    text: "Same card. Different country. Different meaning." },
  { fromFrame: sec(4),    toFrame: sec(8),    text: "Complete in one country, incomplete in another." },
  { fromFrame: sec(8),    toFrame: sec(13),   text: "A child crosses a border. Their schedule doesn't." },
  { fromFrame: sec(13),   toFrame: sec(18),   text: "Now a clinician has to decide what counts." },
  { fromFrame: sec(18),   toFrame: sec(23),   text: "Hathor reads the card — every field with a confidence score." },
  { fromFrame: sec(23),   toFrame: sec(28),   text: "Anything uncertain is routed to a clinician for review." },
  { fromFrame: sec(28),   toFrame: sec(33),   text: "Then it aligns what was given against what's expected." },
  { fromFrame: sec(33),   toFrame: sec(38),   text: "Coverage is tracked per antigen — even when one injection covers several." },
  { fromFrame: sec(38),   toFrame: sec(43),   text: "Before anything reaches the clinician,\nevery output is checked by deterministic rules." },
  { fromFrame: sec(43),   toFrame: sec(47.5), text: "What the clinician sees is a structured view —" },
  { fromFrame: sec(47.5), toFrame: sec(52),   text: "documented doses, gaps, and a provenance trail for every decision." },
  { fromFrame: sec(52),   toFrame: sec(56),   text: "The agent reasons. The rules verify." },
  { fromFrame: sec(56),   toFrame: sec(60),   text: "The clinician decides — always." },
];
