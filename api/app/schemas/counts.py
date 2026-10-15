from pydantic import BaseModel


class CountsRead(BaseModel):
    """Each field equals the `total` of the list its badge opens, for the same caller.

    `time_off_pending` is null for a Manager, who has no all-Staff Time off list; the key is
    always present.
    """

    needs_attention: int
    time_off_pending: int | None
    children_awaiting_evaluation: int
    bookings_to_sort_out: int
    unread_chats: int
