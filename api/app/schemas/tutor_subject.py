"""Request and response shapes for the tutor-subject assignment routes."""

import uuid
from typing import Annotated

from pydantic import BaseModel, Field

from app.models.child import HIGHEST_GRADE, LOWEST_GRADE


class TutorSubjectCreate(BaseModel):
    subject_id: uuid.UUID
    # Required, not optional: an assignment with no ceiling would match every child or none,
    # both silent failures.
    max_grade_level: Annotated[int, Field(ge=LOWEST_GRADE, le=HIGHEST_GRADE)]


class TutorSubjectAssignmentRead(BaseModel):
    subject_id: uuid.UUID
    name: str
    max_grade_level: int
