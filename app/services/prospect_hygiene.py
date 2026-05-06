from __future__ import annotations

import re
from typing import Optional


ROLE_LOCAL_PART_PATTERNS = (
    "noreply",
    "no-reply",
    "no_reply",
    "donotreply",
    "do-not-reply",
    "do_not_reply",
    "mailer-daemon",
    "postmaster",
    "notifications",
    "notification",
    "calendar",
    "invite",
    "invites",
    "support",
    "help",
    "success",
    "team",
    "updates",
    "alerts",
    "billing",
    "admin",
    "info",
)

GENERIC_NAME_TOKENS = {
    "contact",
    "team",
    "support",
    "notifications",
    "notification",
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "admin",
    "info",
}


def _normalize_name_token(value: str | None) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").strip().lower())
    return " ".join(cleaned.split())


def normalize_email(email: str | None) -> str:
    value = (email or "").strip().lower()
    if not value or "@" not in value:
        return ""
    return value


def is_system_email_address(email: str | None) -> bool:
    normalized = normalize_email(email)
    if not normalized:
        return False

    local, _, domain = normalized.partition("@")
    if not local or not domain:
        return False

    if domain == "beacon.li":
        return True

    compact_local = re.sub(r"[^a-z0-9]+", "", local)
    if compact_local.startswith("zippy"):
        return True

    local_tokens = {token for token in re.split(r"[^a-z0-9]+", local) if token}
    if any(pattern in local for pattern in ROLE_LOCAL_PART_PATTERNS):
        return True
    if local_tokens & {token.replace("-", "").replace("_", "") for token in GENERIC_NAME_TOKENS}:
        return True

    if "+" in local and any(pattern in compact_local for pattern in ("noreply", "notification", "calendar", "invite")):
        return True

    return False


def is_placeholder_contact_name(
    first_name: str | None,
    last_name: str | None,
) -> bool:
    first = _normalize_name_token(first_name)
    last = _normalize_name_token(last_name)
    if not first and not last:
        return True

    if last in GENERIC_NAME_TOKENS:
        return True

    full_name = " ".join(part for part in [first, last] if part)
    if any(token in full_name for token in GENERIC_NAME_TOKENS):
        if len(full_name.split()) <= 2:
            return True

    return False


def is_valid_prospect_candidate(
    *,
    first_name: str | None,
    last_name: str | None,
    email: str | None,
    title: str | None = None,
    linkedin_url: str | None = None,
) -> bool:
    normalized_email = normalize_email(email)
    normalized_title = (title or "").strip()
    normalized_linkedin = (linkedin_url or "").strip()

    if normalized_email and is_system_email_address(normalized_email):
        return False

    if is_placeholder_contact_name(first_name, last_name):
        # If a user explicitly added strong person-like data, let it through.
        if not normalized_title and not normalized_linkedin:
            return False

    if not any([(first_name or "").strip(), (last_name or "").strip(), normalized_email, normalized_title, normalized_linkedin]):
        return False

    return True


def invalid_prospect_reason(
    *,
    first_name: str | None,
    last_name: str | None,
    email: str | None,
    title: str | None = None,
    linkedin_url: str | None = None,
) -> Optional[str]:
    normalized_email = normalize_email(email)
    if normalized_email and is_system_email_address(normalized_email):
        return "This looks like a system or role-based mailbox, not a real prospect."
    if is_placeholder_contact_name(first_name, last_name) and not (title or "").strip() and not (linkedin_url or "").strip():
        return "This contact looks like a placeholder rather than a real person."
    if not is_valid_prospect_candidate(
        first_name=first_name,
        last_name=last_name,
        email=email,
        title=title,
        linkedin_url=linkedin_url,
    ):
        return "This row does not look like a valid prospect."
    return None
