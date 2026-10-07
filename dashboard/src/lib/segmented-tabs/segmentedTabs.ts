// The tab's id, so the caller's panel can name itself with `aria-labelledby`.
export const segmentedTabId = (panelId: string, value: string): string => `${panelId}-tab-${value}`
