"""The page envelope every list response is wrapped in.

One shape everywhere, with **no exceptions** — including endpoints bounded by design, like
`/api/slots/available` and `/api/tutors/{id}/availability`. Carving out the ones that
"obviously don't need paging" reintroduces the "which shape is this one?" problem the envelope
exists to remove, and the exceptions are never the ones you predicted.

`total` counts rows matching the query **before** paging or any cap, which is the whole point:
it reports how many rows the page left out. (`/api/slots/available` is uncapped and returns
every open slot; the bot's five-slot cap lives in `slot_service`, where its `total` lets it say
"showing 5 of 8".)
"""

from pydantic import BaseModel

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


class Page[ItemT](BaseModel):
    items: list[ItemT]
    total: int
    page: int
    page_size: int


class PageParams(BaseModel):
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size
