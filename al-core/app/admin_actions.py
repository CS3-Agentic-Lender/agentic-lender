"""The admin activity log: one `admin_actions/{id}` document per successful admin action (al-core/SCHEMA.md).

Callers write it in the same batch as the change it records, so a change is never saved without its record.
"""

from google.cloud.firestore import SERVER_TIMESTAMP

COLLECTION = "admin_actions"


def action_doc(actor_uid: str, action: str, *, target_uid: str | None = None, target_ref: str | None = None,
               details: dict | None = None) -> dict:
    doc = {"actorUid": actor_uid, "action": action, "details": details or {}, "createdAt": SERVER_TIMESTAMP}
    if target_uid is not None:
        doc["targetUid"] = target_uid
    if target_ref is not None:
        doc["targetRef"] = target_ref
    return doc
