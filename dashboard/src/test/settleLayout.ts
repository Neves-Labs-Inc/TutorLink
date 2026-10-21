// The app font is `font-display: swap`; measuring before it lands reads the fallback font's layout.
const APP_FONT = '400 14px "Inter Variable"'

// Waits for the app font and one frame so geometry reads see the final layout.
export const settleLayout = async (): Promise<void> => {
  // Explicit load: `fonts.ready` alone resolves early if no text has requested the font yet.
  await document.fonts.load(APP_FONT)
  await document.fonts.ready
  await new Promise(requestAnimationFrame)
}
