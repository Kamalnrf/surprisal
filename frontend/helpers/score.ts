// Truncates instead of rounding so a below-threshold score never reads as
// passing (0.799 shows 0.79, not 0.80). The epsilon absorbs float noise such
// as 0.29 * 100 = 28.999999999999996.
export function formatScore(score: number, threshold: number): string {
  let shown = Math.floor(score * 100 + 1e-9) / 100;
  if (score < threshold && shown >= threshold) {
    shown = (Math.round(threshold * 100) - 1) / 100;
  }
  return shown.toFixed(2);
}
