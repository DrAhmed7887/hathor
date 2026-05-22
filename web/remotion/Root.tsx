/**
 * Remotion Root — registers all video compositions for the Hathor hackathon video.
 * Run: npx remotion studio   (preview in browser)
 *      npx remotion render AgentFanOut out.mp4
 */

import { Composition, registerRoot } from "remotion";

import { AgentFanOut, FAN_FPS, FAN_DURATION_FRAMES, FAN_WIDTH, FAN_HEIGHT } from "./AgentFanOut";
import { CostAnimation, COST_FPS, COST_DURATION_FRAMES, COST_WIDTH, COST_HEIGHT } from "./CostAnimation";
import { SafetyGates, GATES_FPS, GATES_DURATION_FRAMES, GATES_WIDTH, GATES_HEIGHT } from "./SafetyGates";
import { HeroIntro, HERO_FPS, HERO_DURATION_FRAMES, HERO_WIDTH, HERO_HEIGHT } from "./HeroIntro";
import { PitchDeck, PITCH_FPS, PITCH_DURATION_FRAMES, PITCH_WIDTH, PITCH_HEIGHT } from "./PitchDeck";
import { ExplainerParse, EXPLAIN_FPS, EXPLAIN_DURATION_FRAMES, EXPLAIN_WIDTH, EXPLAIN_HEIGHT } from "./ExplainerParse";
import {
  Hathor60s,
  HATHOR60S_FPS,
  HATHOR60S_DURATION_FRAMES,
  HATHOR60S_WIDTH,
  HATHOR60S_HEIGHT,
} from "./hathor60s/Hathor60s";

function RemotionRoot() {
  return (
    <>
      {/* ── 60-second vertical short (storyboard package) ── */}
      <Composition
        id="Hathor60s"
        component={Hathor60s}
        fps={HATHOR60S_FPS}
        durationInFrames={HATHOR60S_DURATION_FRAMES}
        width={HATHOR60S_WIDTH}
        height={HATHOR60S_HEIGHT}
      />

      {/* ── Hackathon video renders ── */}
      <Composition
        id="AgentFanOut"
        component={AgentFanOut}
        fps={FAN_FPS}
        durationInFrames={FAN_DURATION_FRAMES}
        width={FAN_WIDTH}
        height={FAN_HEIGHT}
      />
      <Composition
        id="CostAnimation"
        component={CostAnimation}
        fps={COST_FPS}
        durationInFrames={COST_DURATION_FRAMES}
        width={COST_WIDTH}
        height={COST_HEIGHT}
      />
      <Composition
        id="SafetyGates"
        component={SafetyGates}
        fps={GATES_FPS}
        durationInFrames={GATES_DURATION_FRAMES}
        width={GATES_WIDTH}
        height={GATES_HEIGHT}
      />

      {/* ── App-embedded compositions ── */}
      <Composition
        id="HeroIntro"
        component={HeroIntro}
        fps={HERO_FPS}
        durationInFrames={HERO_DURATION_FRAMES}
        width={HERO_WIDTH}
        height={HERO_HEIGHT}
      />
      <Composition
        id="PitchDeck"
        component={PitchDeck}
        fps={PITCH_FPS}
        durationInFrames={PITCH_DURATION_FRAMES}
        width={PITCH_WIDTH}
        height={PITCH_HEIGHT}
      />
      <Composition
        id="ExplainerParse"
        component={ExplainerParse}
        fps={EXPLAIN_FPS}
        durationInFrames={EXPLAIN_DURATION_FRAMES}
        width={EXPLAIN_WIDTH}
        height={EXPLAIN_HEIGHT}
      />
    </>
  );
}

registerRoot(RemotionRoot);
