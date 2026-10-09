import datetime

from pydantic import BaseModel

from app.schemas.booking import BookingSummary


class StatsOverview(BaseModel):
    """`recent_bookings` reuses `BookingSummary` rather than declaring a second shape: the
    contract (`docs/api-design.md:1322`) requires each item to be field-identical to a
    `GET /api/bookings` item, and a copy of the shape is a second thing to keep in step."""

    date: datetime.date
    week_end: datetime.date
    today_session_count: int
    upcoming_week_session_count: int
    today_evaluation_count: int
    upcoming_week_evaluation_count: int
    active_tutor_count: int
    active_client_count: int
    recent_bookings: list[BookingSummary]
