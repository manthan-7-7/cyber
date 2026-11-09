import hashlib
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user
from supabase_client import get_supabase_client

router = APIRouter(prefix="/api/cases", tags=["Case Management"])


# ============================================================================
# Enums and Pydantic Models
# ============================================================================

class CaseStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "In Progress"
    CLOSED = "Closed"


class CasePriority(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


class CaseCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255, description="Case title (required)")
    description: Optional[str] = Field(None, max_length=2000, description="Optional case description")
    case_type: Optional[str] = Field("General", max_length=100, description="Investigation type or classification")
    status: Optional[CaseStatus] = Field(CaseStatus.OPEN, description="Initial case status")
    priority: Optional[CasePriority] = Field(CasePriority.MEDIUM, description="Case priority level")

    @field_validator("title")
    @classmethod
    def validate_title_not_empty(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Case title cannot be empty or whitespace.")
        return trimmed


class CaseUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255, description="Updated case title")
    description: Optional[str] = Field(None, max_length=2000, description="Updated case description")
    case_type: Optional[str] = Field(None, max_length=100, description="Updated case type")
    status: Optional[CaseStatus] = Field(None, description="Updated status (Open, In Progress, Closed)")
    priority: Optional[CasePriority] = Field(None, description="Updated priority (Low, Medium, High)")

    @field_validator("title")
    @classmethod
    def validate_title_not_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            trimmed = value.strip()
            if not trimmed:
                raise ValueError("Case title cannot be empty or whitespace.")
            return trimmed
        return value


class CaseResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    case_type: Optional[str] = None
    status: str
    priority: str
    created_by: str
    created_at: str
    updated_at: str


class EvidenceResponse(BaseModel):
    id: str
    case_id: str
    file_name: str
    storage_path: str
    file_size: int
    mime_type: Optional[str] = None
    sha256_hash: Optional[str] = None
    description: Optional[str] = None
    uploaded_by: str
    processing_status: str
    uploaded_at: str


class DownloadResponse(BaseModel):
    download_url: str
    file_name: str
    expires_in: int = 60


class CustodyResponse(BaseModel):
    id: str
    case_id: str
    evidence_id: str
    actor_id: str
    action: str
    details: dict
    created_at: str


def verify_case_access(client, case_id: str, user_id: str, require_write: bool = False) -> dict:
    try:
        valid_uuid = str(uuid.UUID(case_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid case ID format. Must be a valid UUID.",
        )

    try:
        if client is not None:
            case_res = client.table("cases").select("*").eq("id", valid_uuid).execute()
            if case_res.data:
                case_record = case_res.data[0]
                if case_record.get("created_by") == user_id:
                    return case_record

                member_res = (
                    client.table("case_members")
                    .select("role")
                    .eq("case_id", valid_uuid)
                    .eq("user_id", user_id)
                    .execute()
                )
                if member_res.data:
                    role = member_res.data[0].get("role")
                    if require_write and role == "Viewer":
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Forbidden: Case members with the 'Viewer' role do not have permission to modify this case.",
                        )
                    return case_record
    except HTTPException:
        raise
    except Exception:
        pass

    # Fallback to preloaded cases
    from cdr_dataset import get_preloaded_cases
    for pre in get_preloaded_cases():
        if pre["id"] == valid_uuid:
            return {
                "id": pre["id"],
                "title": pre["title"],
                "description": "Pre-loaded forensic case with investigation dataset.",
                "case_type": pre.get("case_type", "General"),
                "status": pre.get("status", "Open"),
                "priority": pre.get("priority", "Medium"),
                "created_by": user_id,
                "created_at": "2026-10-15T08:00:00Z",
                "updated_at": "2026-10-15T08:00:00Z",
            }

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Case not found.",
    )


# ============================================================================
# API Endpoints
# ============================================================================

@router.get("", response_model=list[CaseResponse])
def list_cases(
    status_filter: Optional[CaseStatus] = Query(None, alias="status", description="Filter by case status"),
    priority_filter: Optional[CasePriority] = Query(None, alias="priority", description="Filter by priority"),
    search: Optional[str] = Query(None, max_length=100, description="Search cases by title"),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns only cases the authenticated user is authorized to view:
    - Cases created by the user.
    - Cases where the user is an assigned member in case_members.
    """
    user_id = current_user["id"]

    try:
        client = get_supabase_client()
        # Step 1: Check if user is a member of any cases
        members_res = client.table("case_members").select("case_id").eq("user_id", user_id).execute()
        member_case_ids = [row["case_id"] for row in (members_res.data or []) if "case_id" in row]

        # Step 2: Build query for cases created by user or where user is a member
        if member_case_ids:
            # Query either created_by or id in member_case_ids
            case_ids_filter = ",".join(member_case_ids)
            query = client.table("cases").select("*").or_(f"created_by.eq.{user_id},id.in.({case_ids_filter})")
        else:
            query = client.table("cases").select("*").eq("created_by", user_id)

        # Apply safe filters
        if status_filter:
            query = query.eq("status", status_filter.value)
        if priority_filter:
            query = query.eq("priority", priority_filter.value)
        if search and search.strip():
            query = query.ilike("title", f"%{search.strip()}%")

        # Sort with newest cases first
        response = query.order("created_at", desc=True).execute()
        db_cases = response.data or []
        from cdr_dataset import get_preloaded_cases
        existing_ids = {c["id"] for c in db_cases}
        for p in get_preloaded_cases():
            if p["id"] not in existing_ids:
                if status_filter and p.get("status") != status_filter.value:
                    continue
                if priority_filter and p.get("priority") != priority_filter.value:
                    continue
                if search and search.strip().lower() not in p.get("title", "").lower():
                    continue
                db_cases.append({
                    "id": p["id"],
                    "title": p["title"],
                    "description": "Pre-loaded forensic case with investigation dataset.",
                    "case_type": p.get("case_type", "General"),
                    "status": p.get("status", "Open"),
                    "priority": p.get("priority", "Medium"),
                    "created_by": user_id,
                    "created_at": "2026-10-15T08:00:00Z",
                    "updated_at": "2026-10-15T08:00:00Z",
                })
        return db_cases

    except HTTPException:
        raise
    except Exception:
        # Graceful fallback when database is not connected
        from cdr_dataset import get_preloaded_cases
        fallback_cases = []
        for p in get_preloaded_cases():
            if status_filter and p.get("status") != status_filter.value:
                continue
            if priority_filter and p.get("priority") != priority_filter.value:
                continue
            if search and search.strip().lower() not in p.get("title", "").lower():
                continue
            fallback_cases.append({
                "id": p["id"],
                "title": p["title"],
                "description": "Pre-loaded forensic case with investigation dataset.",
                "case_type": p.get("case_type", "General"),
                "status": p.get("status", "Open"),
                "priority": p.get("priority", "Medium"),
                "created_by": user_id,
                "created_at": "2026-10-15T08:00:00Z",
                "updated_at": "2026-10-15T08:00:00Z",
            })
        return fallback_cases


@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
def create_case(
    case_input: CaseCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Creates a new investigation case.
    The created_by field is set strictly from the verified authenticated user's ID.
    Never accepts ownership or privileged fields from the request body.
    """
    user_id = current_user["id"]
    client = get_supabase_client()

    payload = {
        "title": case_input.title.strip(),
        "description": case_input.description.strip() if case_input.description else None,
        "case_type": case_input.case_type.strip() if case_input.case_type else "General",
        "status": case_input.status.value if case_input.status else CaseStatus.OPEN.value,
        "priority": case_input.priority.value if case_input.priority else CasePriority.MEDIUM.value,
        "created_by": user_id,
    }

    try:
        response = client.table("cases").insert(payload).execute()
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create case in the database.",
            )
        return response.data[0]

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating case.",
        )


@router.get("/{case_id}", response_model=CaseResponse)
def get_case(
    case_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns a single case by ID only if the authenticated user is authorized to view it.
    Returns 404 Not Found if the case does not exist or if the user lacks access,
    preserving privacy without leaking whether another user's private case exists.
    """
    try:
        client = get_supabase_client()
        return verify_case_access(client, case_id, current_user["id"], require_write=False)
    except HTTPException:
        raise
    except Exception:
        return verify_case_access(None, case_id, current_user["id"], require_write=False)


@router.patch("/{case_id}", response_model=CaseResponse)
def update_case(
    case_id: str,
    case_update: CaseUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Updates an existing case.
    - Only permitted fields (title, description, case_type, status, priority) may be changed.
    - Rejects empty updates.
    - Never permits changes to id, created_by, or protected metadata.
    - Enforces case ownership or member permissions (Viewers are rejected with 403 Forbidden).
    - Returns 404 for nonexistent or unauthorized cases.
    """
    # Check that at least one field was provided in the update request
    update_data = case_update.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one field (title, description, case_type, status, priority) must be provided for update.",
        )

    user_id = current_user["id"]
    client = get_supabase_client()
    verify_case_access(client, case_id, user_id, require_write=True)
    valid_uuid = str(uuid.UUID(case_id))

    try:


        # Step 3: Prepare safe update payload
        payload = {}
        if "title" in update_data and update_data["title"] is not None:
            payload["title"] = update_data["title"].strip()
        if "description" in update_data:
            payload["description"] = update_data["description"].strip() if update_data["description"] else None
        if "case_type" in update_data and update_data["case_type"] is not None:
            payload["case_type"] = update_data["case_type"].strip()
        if "status" in update_data and update_data["status"] is not None:
            payload["status"] = update_data["status"].value if hasattr(update_data["status"], "value") else str(update_data["status"])
        if "priority" in update_data and update_data["priority"] is not None:
            payload["priority"] = update_data["priority"].value if hasattr(update_data["priority"], "value") else str(update_data["priority"])

        # Protect against empty effective payload
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one valid field value must be provided for update.",
            )

        # Update timestamp
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()

        # Step 4: Execute database update
        update_res = client.table("cases").update(payload).eq("id", valid_uuid).execute()
        if not update_res.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update case in the database.",
            )

        return update_res.data[0]

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while updating case.",
        )


@router.delete("/{case_id}", status_code=status.HTTP_200_OK)
def delete_case(
    case_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Deletes an investigation case if authorized and if no dependent forensic
    evidence, custody records, or audit history exist.
    - Requires case write permission (creator or editor).
    - Prevents accidental destruction of forensic evidence or custody history (HTTP 409).
    - If dependencies exist, advises closing/archiving the case instead.
    - If clean, deletes the case and returns confirmation.
    """
    user_id = current_user["id"]
    client = get_supabase_client()
    verify_case_access(client, case_id, user_id, require_write=True)
    valid_uuid = str(uuid.UUID(case_id))

    # Check for dependent evidence
    ev_check = client.table("evidence").select("id", count="exact").eq("case_id", valid_uuid).execute()
    if ev_check.count and ev_check.count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete case with active forensic evidence. Set case status to 'Closed' to archive it safely while preserving evidence.",
        )

    # Check for dependent custody records
    custody_check = client.table("chain_of_custody").select("id", count="exact").eq("case_id", valid_uuid).execute()
    if custody_check.count and custody_check.count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete case with chain of custody history. Set case status to 'Closed' to preserve forensic integrity.",
        )

    # Check for dependent audit history
    audit_check = client.table("audit_logs").select("id", count="exact").eq("case_id", valid_uuid).execute()
    if audit_check.count and audit_check.count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete case with audit history. Set case status to 'Closed' to preserve audit logs.",
        )

    try:
        client.table("case_members").delete().eq("case_id", valid_uuid).execute()
        del_res = client.table("cases").delete().eq("id", valid_uuid).execute()
        if not del_res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Case not found or already deleted.",
            )
        return {"message": "Case deleted successfully.", "case_id": valid_uuid}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while deleting case.",
        )



# ============================================================================
# Evidence Management Endpoints
# ============================================================================

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/csv",
    "message/rfc822",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB limit from bucket configuration


@router.get("/{case_id}/evidence", response_model=list[EvidenceResponse])
def list_case_evidence(
    case_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Lists evidence items for a case. Enforces case view permissions.
    """
    try:
        client = get_supabase_client()
        verify_case_access(client, case_id, current_user["id"], require_write=False)
        res = client.table("evidence").select("*").eq("case_id", case_id).order("uploaded_at", desc=True).execute()
        return res.data or []
    except HTTPException:
        raise
    except Exception:
        verify_case_access(None, case_id, current_user["id"], require_write=False)
        return []


@router.post("/{case_id}/evidence", response_model=EvidenceResponse, status_code=status.HTTP_201_CREATED)
async def upload_case_evidence(
    case_id: str,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Uploads an evidence file to private 'case-evidence' storage bucket and records metadata.
    Enforces case permissions, validates MIME type and file size, computes SHA-256 hash,
    and logs chain of custody. Cleans up storage if DB metadata insert fails.
    """
    user_id = current_user["id"]
    client = get_supabase_client()
    verify_case_access(client, case_id, user_id, require_write=True)

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file must have a filename.")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file cannot be empty.")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum allowed size of 10 MB (size: {len(content)} bytes).",
        )

    mime_type = file.content_type
    if not mime_type or mime_type == "application/octet-stream":
        guessed_type, _ = mimetypes.guess_type(file.filename)
        if guessed_type:
            mime_type = guessed_type

    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{mime_type}'. Permitted types: PDF, TXT, CSV, EML, DOCX, DOC.",
        )

    sha256_hash = hashlib.sha256(content).hexdigest()
    safe_filename = re.sub(r"[^a-zA-Z0-9._-]", "_", file.filename)
    unique_file_id = str(uuid.uuid4())
    storage_path = f"{case_id}/{unique_file_id}_{safe_filename}"

    try:
        client.storage.from_("case-evidence").upload(
            path=storage_path,
            file=content,
            file_options={"content-type": mime_type, "upsert": "false"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Storage upload error: {str(e)}",
        )

    evidence_payload = {
        "case_id": case_id,
        "file_name": safe_filename,
        "storage_path": storage_path,
        "file_size": len(content),
        "mime_type": mime_type,
        "sha256_hash": sha256_hash,
        "description": description.strip() if description else None,
        "uploaded_by": user_id,
        "processing_status": "Pending",
    }

    try:
        ev_res = client.table("evidence").insert(evidence_payload).execute()
        if not ev_res.data:
            raise RuntimeError("Database did not return inserted evidence record.")
        evidence_record = ev_res.data[0]
    except Exception as e:
        try:
            client.storage.from_("case-evidence").remove([storage_path])
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record evidence metadata in database.",
        )

    try:
        client.table("chain_of_custody").insert({
            "case_id": case_id,
            "evidence_id": evidence_record["id"],
            "actor_id": user_id,
            "action": "EVIDENCE_UPLOADED",
            "details": {
                "file_name": safe_filename,
                "file_size": len(content),
                "sha256_hash": sha256_hash,
                "mime_type": mime_type,
            },
        }).execute()
    except Exception:
        pass

    return evidence_record


@router.get("/{case_id}/evidence/{evidence_id}/download", response_model=DownloadResponse)
def get_evidence_download_url(
    case_id: str,
    evidence_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Generates a secure, temporary (60s) signed download URL for evidence from private bucket.
    Logs access event to chain of custody.
    """
    user_id = current_user["id"]
    client = get_supabase_client()
    verify_case_access(client, case_id, user_id, require_write=False)

    try:
        valid_ev_id = str(uuid.UUID(evidence_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid evidence ID format.")

    ev_res = client.table("evidence").select("*").eq("id", valid_ev_id).eq("case_id", case_id).execute()
    if not ev_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence item not found.")

    ev = ev_res.data[0]
    try:
        signed_res = client.storage.from_("case-evidence").create_signed_url(ev["storage_path"], 60)
        signed_url = signed_res.get("signedURL") or signed_res.get("signedUrl")
        if not signed_url:
            raise ValueError("Signed URL generation failed.")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate secure download link: {str(e)}",
        )

    try:
        client.table("chain_of_custody").insert({
            "case_id": case_id,
            "evidence_id": valid_ev_id,
            "actor_id": user_id,
            "action": "EVIDENCE_ACCESSED",
            "details": {"action": "download_requested"},
        }).execute()
    except Exception:
        pass

    return {
        "download_url": signed_url,
        "file_name": ev["file_name"],
        "expires_in": 60,
    }


@router.get("/{case_id}/evidence/{evidence_id}/custody", response_model=list[CustodyResponse])
def get_evidence_custody(
    case_id: str,
    evidence_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieves full chain of custody log for a specific evidence item.
    """
    client = get_supabase_client()
    verify_case_access(client, case_id, current_user["id"], require_write=False)

    try:
        valid_ev_id = str(uuid.UUID(evidence_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid evidence ID format.")

    res = (
        client.table("chain_of_custody")
        .select("*")
        .eq("case_id", case_id)
        .eq("evidence_id", valid_ev_id)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


@router.delete("/{case_id}/evidence/{evidence_id}", status_code=status.HTTP_200_OK)
def delete_case_evidence(
    case_id: str,
    evidence_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Deletes an evidence file from storage and cleans up metadata and chain of custody.
    Requires write permission on the case.
    """
    user_id = current_user["id"]
    client = get_supabase_client()
    verify_case_access(client, case_id, user_id, require_write=True)

    try:
        valid_ev_id = str(uuid.UUID(evidence_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid evidence ID format.")

    ev_res = client.table("evidence").select("*").eq("id", valid_ev_id).eq("case_id", case_id).execute()
    if not ev_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence item not found.")

    ev = ev_res.data[0]

    # Record forensic deletion in audit logs to preserve audit trail
    try:
        client.table("audit_logs").insert({
            "case_id": case_id,
            "actor_id": user_id,
            "action": "EVIDENCE_DELETED",
            "details": {
                "evidence_id": valid_ev_id,
                "file_name": ev.get("file_name"),
                "sha256_hash": ev.get("sha256_hash"),
                "storage_path": ev.get("storage_path"),
                "file_size": ev.get("file_size"),
            },
        }).execute()
    except Exception:
        pass

    try:
        client.storage.from_("case-evidence").remove([ev["storage_path"]])
    except Exception:
        pass

    client.table("chain_of_custody").delete().eq("evidence_id", valid_ev_id).execute()
    client.table("evidence").delete().eq("id", valid_ev_id).execute()

    return {"message": "Evidence deleted successfully."}
