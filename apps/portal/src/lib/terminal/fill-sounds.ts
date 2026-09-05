// Quiet Web Audio fill / trigger beeps. No asset files — short oscillators.
// Respect mute + prefers-reduced-motion at the call site.

let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

function tone(
  frequency: number,
  durationMs: number,
  gain = 0.035,
  type: OscillatorType = "sine",
): void {
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  amp.gain.setValueAtTime(0, now);
  amp.gain.linearRampToValueAtTime(gain, now + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

/** Soft blip for a fill / open. */
export function playFillSound(): void {
  tone(880, 70, 0.03);
}

/** Slightly brighter blip for TP/SL trigger. */
export function playTriggerSound(): void {
  tone(1175, 55, 0.028);
  window.setTimeout(() => tone(1568, 45, 0.02), 40);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function defaultFillSoundsEnabled(): boolean {
  return !prefersReducedMotion();
}
