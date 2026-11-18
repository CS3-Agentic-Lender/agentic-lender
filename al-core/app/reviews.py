"""PUT /core/reviews/me keeps the signed-in borrower's one review of the app (AL-74).

A review is stored at reviews/{uid} (SCHEMA.md): the document id is the borrower's uid, so a borrower has one
review and writing again replaces it. The borrower's id comes from the token, never from the body, so nobody can
write another borrower's review. Only this API writes to the collection. The borrower reads their own review and
underwriters read all of them, directly from Firestore (firestore.rules).
"""

from fastapi import APIRouter, Depends
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.applications import _iso
from app.auth import require_role
from app.firestore import db

router = APIRouter(prefix="/core", tags=["reviews"])

MAX_COMMENT = 500


class ReviewIn(BaseModel):
    """What the client sends. Anything else, such as a user id or a time, is ignored."""

    model_config = ConfigDict(str_strip_whitespace=True)

    rating: int = Field(ge=1, le=5, strict=True)  # 1 to 5 stars; 4.5, "5" and true are refused
    comment: str | None = Field(default=None, max_length=MAX_COMMENT)

    @field_validator("comment")
    @classmethod
    def blank_is_no_comment(cls, v: str | None) -> str | None:
        return v or None  # "" and whitespace mean the borrower left no comment


class ReviewOut(BaseModel):
    rating: int
    comment: str | None
    created_at: str | None
    updated_at: str | None


def _out(doc: dict) -> dict:
    return {
        "rating": doc["rating"],
        "comment": doc.get("comment"),
        "created_at": _iso(doc.get("createdAt")),
        "updated_at": _iso(doc.get("updatedAt")),
    }


@router.put("/reviews/me", response_model=ReviewOut)
def put_review(body: ReviewIn, user: dict = Depends(require_role("borrower"))):
    """Save the signed-in borrower's review, replacing the one they had. 200 whether it is new or replaced."""
    ref = db().collection("reviews").document(user["uid"])
    before = ref.get()
    first = before.to_dict().get("createdAt") if before.exists else None
    ref.set({
        "userId": user["uid"],
        "rating": body.rating,
        "comment": body.comment,
        "createdAt": first or SERVER_TIMESTAMP,  # the first review's time stays; a replacement only moves updatedAt
        "updatedAt": SERVER_TIMESTAMP,
    })
    return _out(ref.get().to_dict())
