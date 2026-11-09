"""
CDR Utilities: Phone Number Normalization, Validation, and Datetime Helpers.
Provides robust handling for Indian standard 10-digit numbers, international prefixes,
and consistent timezone/timestamp parsing.
"""

import re
from datetime import datetime, timezone
from typing import Optional, Tuple


def normalize_phone_number(raw_number: str) -> str:
    """
    Normalizes a phone number to standard digit format for reliable comparisons:
    - Strips spaces, dashes, dots, brackets, and plus signs.
    - Handles Indian standard: 10 digits (e.g., 9876543210).
    - If number starts with country code 91 (12 digits) or +91: extracts canonical 10-digit number.
    - If number starts with leading 0 (11 digits, e.g. 09876543210): strips leading zero to 10 digits.
    - Preserves international numbers starting with country code when not Indian.
    """
    if not raw_number:
        return ""

    cleaned = re.sub(r"[\s\-\(\)\.\+]", "", str(raw_number).strip())

    # Indian 12-digit number starting with 91 (e.g. 919876543210)
    if len(cleaned) == 12 and cleaned.startswith("91"):
        return cleaned[2:]

    # Indian 11-digit number with leading 0 (e.g. 09876543210)
    if len(cleaned) == 11 and cleaned.startswith("0"):
        return cleaned[1:]

    return cleaned


def validate_mobile_number(raw_number: str) -> Tuple[bool, str, Optional[str]]:
    """
    Validates a mobile number input for investigation search.
    Returns: (is_valid, normalized_number, error_message)
    """
    if not raw_number or not str(raw_number).strip():
        return False, "", "Mobile number cannot be empty."

    trimmed = str(raw_number).strip()

    # Reject if contains letters or illegal characters
    if re.search(r"[a-zA-Z]", trimmed):
        return False, "", "Mobile number must not contain alphabetic characters."

    normalized = normalize_phone_number(trimmed)

    # Check minimum and maximum digit counts
    if len(normalized) < 7:
        return False, normalized, "Mobile number is too short. Minimum 7 digits required."

    if len(normalized) > 15:
        return False, normalized, "Mobile number exceeds maximum standard length of 15 digits."

    # Validate standard Indian mobile number (starts with 6, 7, 8, or 9 and has 10 digits)
    if len(normalized) == 10:
        if normalized[0] not in "6789":
            return True, normalized, None  # Valid standard number format, but not strictly Indian cell
        return True, normalized, None

    return True, normalized, None


def numbers_match(num1: str, num2: str) -> bool:
    """
    Compares two phone numbers after normalizing them.
    Returns True if both refer to the same subscriber line.
    """
    n1 = normalize_phone_number(num1)
    n2 = normalize_phone_number(num2)
    if not n1 or not n2:
        return False

    if n1 == n2:
        return True

    # Also handle suffix match if one has country code and other doesn't (last 10 digits)
    if len(n1) >= 10 and len(n2) >= 10:
        return n1[-10:] == n2[-10:]

    return False


def parse_timestamp(timestamp_str: str) -> Optional[datetime]:
    """
    Parses various timestamp formats into a timezone-aware UTC datetime.
    Supports ISO 8601, 'YYYY-MM-DD HH:MM:SS', and date+time combinations.
    """
    if not timestamp_str:
        return None

    cleaned = str(timestamp_str).strip()

    # Try standard ISO 8601 formats
    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%d-%m-%Y %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(cleaned, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue

    # Fallback to datetime.fromisoformat
    try:
        dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def format_duration(seconds: int) -> str:
    """
    Formats seconds into human-readable mm:ss or hh:mm:ss string.
    """
    if seconds < 0:
        return "0s"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    elif minutes > 0:
        return f"{minutes}m {secs}s"
    else:
        return f"{secs}s"
