"""The staff accounts API: an admin lists staff and creates, disables, enables, re-roles and deletes brokers and
underwriters, so the portal never holds the Admin SDK.

Admins are made only by script (the seed on the emulators, scripts/create-hosted-admin.js on the hosted project). Nothing here creates,
changes or deletes an admin, makes anyone one, or touches a borrower. The target's role is read from its `role` claim,
the same thing the rules and the other endpoints trust; the `users/{uid}` profile is kept in step with it.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from firebase_admin import auth as fb_auth
from google.cloud.firestore import DELETE_FIELD, SERVER_TIMESTAMP
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.admin_actions import COLLECTION as ADMIN_ACTIONS, action_doc
from app.auth import require_role
from app.firestore import db
from app.me import EMAIL, PHONE, _iso

router = APIRouter(prefix="/core/admin", tags=["admin"])

STAFF_ROLES = ("broker", "underwriter")  # the only roles this API makes, changes or deletes
LISTED_ROLES = ("admin", *STAFF_ROLES)  # also the order of the staff list
WRONG_ROLE = "Staff accounts are broker or underwriter only. Admins are made by script"


class StaffIn(BaseModel):
    # `role` is checked by hand so any other value is 400, as the spec asks, not a 422 from the model.
    model_config = ConfigDict(str_strip_whitespace=True)

    full_name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=254)
    phone: str
    role: str
    firm: str | None = Field(default=None, max_length=100)

    @field_validator("email")
    @classmethod
    def lower_case_email(cls, v: str) -> str:
        if not EMAIL.match(v):
            raise ValueError("must be a valid email address")
        return v.lower()

    @field_validator("phone")
    @classmethod
    def irish_phone(cls, v: str) -> str:
        v = v.replace(" ", "")
        if not PHONE.match(v):
            raise ValueError("must start +353 followed by 7 to 9 digits")
        return v

    @field_validator("firm")
    @classmethod
    def blank_is_absent(cls, v: str | None) -> str | None:
        return v or None


class StaffChange(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    disabled: bool | None = None
    role: str | None = None
    firm: str | None = Field(default=None, max_length=100)

    @field_validator("firm")
    @classmethod
    def blank_is_absent(cls, v: str | None) -> str | None:
        return v or None


def _invalid(field: str, msg: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("body", field), "msg": msg, "type": "value_error"}])


def _out(uid: str, doc: dict) -> dict:
    return {
        "uid": uid,
        "full_name": doc.get("fullName"),
        "email": doc.get("email"),
        "role": doc.get("role"),
        "firm": doc.get("firm"),
        "phone": doc.get("phone"),
        "enabled": not doc.get("disabled", False),
        "created_at": _iso(doc.get("createdAt")),
    }


def _auth_user(uid: str):
    try:
        return fb_auth.get_user(uid)
    except fb_auth.UserNotFoundError:
        return None


def _target(uid: str, *, need_auth: bool):
    """The account an admin is acting on: its Auth user (or None), profile (or {}) and role. 404 if there is no such
    account, 403 if it is an admin or a borrower. The claim decides the role; the profile only when Auth is gone."""
    user = _auth_user(uid)
    snap = db().collection("users").document(uid).get()
    profile = snap.to_dict() if snap.exists else {}
    if (user is None and need_auth) or (user is None and not profile) or (need_auth and not profile):
        raise HTTPException(404, "No such staff account")
    role = (user.custom_claims or {}).get("role") if user is not None else profile.get("role")
    if role not in STAFF_ROLES:
        raise HTTPException(403, "Only broker and underwriter accounts can be changed here")
    return user, profile, role


def _has_work(uid: str, role: str) -> bool:
    """Anything a broker or underwriter left behind that names them. Each check reads at most one document."""
    def any_where(collection: str, field: str) -> bool:
        query = db().collection(collection).where(filter=FieldFilter(field, "==", uid)).limit(1)
        return next(iter(query.stream()), None) is not None

    if role == "broker":
        return any_where("users", "brokerId") or any_where("applications", "brokerId")
    return any_where("applications", "decision.underwriterId")


def _refuse_if_working(uid: str, role: str, profile: dict) -> None:
    if not _has_work(uid, role):
        return
    name = profile.get("fullName") or profile.get("email") or uid
    if role == "broker":
        raise HTTPException(409, f"{name} still has borrowers or applications. Disable the account instead.")
    raise HTTPException(409, f"{name} has signed off applications. Disable the account instead.")


@router.get("/staff")
def list_staff(user: dict = Depends(require_role("admin"))):
    """Every broker, underwriter and admin. Admins are listed so the portal can show them, read-only."""
    snaps = db().collection("users").where(filter=FieldFilter("role", "in", list(LISTED_ROLES))).stream()
    staff = [_out(snap.id, snap.to_dict()) for snap in snaps]
    return sorted(staff, key=lambda s: (LISTED_ROLES.index(s["role"]), (s["full_name"] or "").lower()))


@router.post("/staff", status_code=201)
def create_staff(body: StaffIn, user: dict = Depends(require_role("admin"))):
    """A Firebase account with no password (the portal then sends the set-your-password email), the role claim and
    a staff profile, which has no address fields."""
    if body.role not in STAFF_ROLES:
        raise HTTPException(400, WRONG_ROLE)
    if body.role == "broker" and not body.firm:
        raise _invalid("firm", "is required for a broker")

    try:
        # No phone_number: Auth wants phone numbers unique, and the profile is where the phone lives.
        created = fb_auth.create_user(email=body.email, display_name=body.full_name, email_verified=False)
    except fb_auth.EmailAlreadyExistsError:
        raise HTTPException(409, "An account with this email already exists")

    uid = created.uid
    profile = {"uid": uid, "role": body.role, "fullName": body.full_name, "email": body.email, "phone": body.phone,
               "disabled": False, "createdAt": SERVER_TIMESTAMP}
    if body.role == "broker":
        profile["firm"] = body.firm
    ref = db().collection("users").document(uid)
    try:
        fb_auth.set_custom_user_claims(uid, {"role": body.role})
        batch = db().batch()
        batch.create(ref, profile)
        batch.create(db().collection(ADMIN_ACTIONS).document(),
                     action_doc(user["uid"], "create_staff", target_uid=uid, details={"role": body.role, "email": body.email}))
        batch.commit()
    except Exception:
        # Half an account would block the email for good (409 on every retry), so take the Auth user back out.
        fb_auth.delete_user(uid)
        raise
    return _out(uid, ref.get().to_dict())


@router.patch("/staff/{uid}")
def change_staff(uid: str, body: StaffChange, user: dict = Depends(require_role("admin"))):
    """Disable or enable, and/or move between broker and underwriter. Sending what is already true changes nothing."""
    if body.disabled is None and body.role is None and not body.firm:
        raise HTTPException(422, "Send disabled, role or both")
    auth_user, profile, role = _target(uid, need_auth=True)

    new_role = body.role if body.role is not None else role
    if new_role not in STAFF_ROLES:
        raise HTTPException(400, WRONG_ROLE)
    role_changes = new_role != role
    if body.firm and not (role_changes and new_role == "broker"):
        raise _invalid("firm", "is only sent with a change of role to broker")
    if role_changes and new_role == "broker" and not body.firm:
        raise _invalid("firm", "is required for a broker")
    if role_changes:
        _refuse_if_working(uid, role, profile)
    disabled_changes = body.disabled is not None and body.disabled != auth_user.disabled

    if role_changes:
        fb_auth.set_custom_user_claims(uid, {"role": new_role})
    if disabled_changes:
        fb_auth.update_user(uid, disabled=body.disabled)
    if role_changes or (disabled_changes and body.disabled):
        # The API refuses a revoked token at once; Firestore rules accept the old ID token until it expires (1 hour).
        fb_auth.revoke_refresh_tokens(uid)

    # The profile follows the claim and Auth, written only where it differs, so a retry after a partial failure
    # finishes the job and a repeat changes nothing.
    updates = {}
    if body.role is not None and profile.get("role") != new_role:
        updates["role"] = new_role
    if body.role is not None and new_role == "broker" and body.firm and profile.get("firm") != body.firm:
        updates["firm"] = body.firm
    if body.role is not None and new_role != "broker" and "firm" in profile:
        updates["firm"] = DELETE_FIELD
    if body.disabled is not None and profile.get("disabled", False) != body.disabled:
        updates["disabled"] = body.disabled

    ref = db().collection("users").document(uid)
    if updates or role_changes or disabled_changes:
        batch = db().batch()
        if updates:
            batch.update(ref, updates)
        log = db().collection(ADMIN_ACTIONS)
        if role_changes:
            batch.create(log.document(), action_doc(user["uid"], "change_role", target_uid=uid,
                                                    details={"from": role, "to": new_role}))
        if disabled_changes:
            batch.create(log.document(), action_doc(user["uid"], "disable_staff" if body.disabled else "enable_staff",
                                                    target_uid=uid))
        batch.commit()
    return _out(uid, ref.get().to_dict())


@router.delete("/staff/{uid}")
def delete_staff(uid: str, user: dict = Depends(require_role("admin"))):
    """Removes the Firebase account and its profile. Refused while the person has work attached: disable instead.
    Nothing on the chain or in any application's history is touched."""
    auth_user, profile, role = _target(uid, need_auth=False)
    _refuse_if_working(uid, role, profile)

    ref = db().collection("users").document(uid)
    batch = db().batch()
    if profile:
        batch.delete(ref)
    batch.create(db().collection(ADMIN_ACTIONS).document(), action_doc(
        user["uid"], "delete_staff", target_uid=uid,
        details={"role": role, "email": profile.get("email"), "fullName": profile.get("fullName")}))
    batch.commit()
    if auth_user is not None:
        try:
            fb_auth.delete_user(uid)
        except fb_auth.UserNotFoundError:
            pass
    return {"deleted": uid}
