// The search box's own text, written to the URL after a pause. A search
// that changes under the box (back, Clear all, a link) shows in it.
import { useEffect, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

type SearchText = { text: string; setText: (text: string) => void };

export function useSearchText(
  urlQuery: string,
  writeQuery: (q: string) => void,
): SearchText {
  const [text, setText] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  // The q this box last wrote. The router applies URL changes in a
  // transition, so it lands later; its arrival must not overwrite the box.
  const [writtenQuery, setWrittenQuery] = useState<string | null>(null);

  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery);
    setWrittenQuery(null);
    if (urlQuery !== writtenQuery) setText(urlQuery);
  }

  useEffect(() => {
    if (text === (writtenQuery ?? syncedQuery)) return;
    const timer = setTimeout(() => {
      setWrittenQuery(text);
      writeQuery(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, syncedQuery, writtenQuery, writeQuery]);

  return { text, setText };
}
