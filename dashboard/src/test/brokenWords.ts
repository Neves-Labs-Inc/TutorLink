// Words inside `elements` that render across more than one line box, i.e. were broken mid-word.
export const findBrokenWords = (elements: HTMLElement[]): string[] =>
  elements.flatMap((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const broken: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange()
        range.setStart(node, match.index)
        range.setEnd(node, match.index + match[0].length)
        const lineTops = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)))
        if (lineTops.size > 1) broken.push(match[0])
      }
    }
    return broken
  })

// Content width beside the admin sidebar at the md, lg and xl breakpoints (768, 1024, 1280).
export const ADMIN_CONTENT_WIDTHS = [464, 704, 960]
export const ADMIN_CONTENT_WIDTH_XL = 960
