export type Page<T> = { items: T[]; total: number; page: number; page_size: number }

export const DEFAULT_PAGE_SIZE = 20
