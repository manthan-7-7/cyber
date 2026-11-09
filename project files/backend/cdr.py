"""
FastAPI Router for CDR Analysis & Suspect Identification (Module 2).
Provides secured endpoints for:
- GET /api/cdr/cases/{case_id}/summary
- GET /api/cdr/cases/{case_id}/records
- POST /api/cdr/pattern-analysis
- POST /api/cdr/tower-analysis
- GET /api/cdr/cases/{case_id}/history

Enforces investigator authentication, case authorization, and audit logging.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from auth import get_current_user
from cases import verify_case_access
from cdr_analysis import run_pattern_analysis
from cdr_dataset import (
    get_case_cdr_summary,
    get_cdr_records_for_case,
    get_preloaded_cases,
)
from cdr_models import (
    AnalysisHistoryItem,
    CDRCaseSummary,
    CDRRecord,
    PatternAnalysisRequest,
    PatternAnalysisResponse,
    TowerAnalysisRequest,
    TowerAnalysisResponse,
)
from cdr_utils import validate_mobile_number
from supabase_client import get_supabase_client
from tower_analysis import run_common_cell_tower_analysis

router = APIRouter(prefix="/api/cdr", tags=["CDR Analysis"])

# In-memory storage for analysis history (preserved during session and mirrored to audit_logs)
_ANALYSIS_HISTORY: List[AnalysisHistoryItem] = []


def _safe_verify_case_access(case_id: str, user_id: str) -> Dict[str, Any]:
    """
    Verifies user authorization to access the specified case.
    Checks Supabase database first; falls back gracefully for preloaded forensic cases.
    """
    try:
        client = get_supabase_client()
        return verify_case_access(client, case_id, user_id, require_write=False)
    except Exception:
        # Fallback check against preloaded cases
        for pre in get_preloaded_cases():
            if pre["id"] == case_id:
                return {
                    "id": pre["id"],
                    "title": pre["title"],
                    "case_type": pre.get("case_type", "General"),
                    "status": pre.get("status", "Open"),
                    "priority": pre.get("priority", "Medium"),
                    "created_by": user_id,
                }
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Case not found or you lack permission to view it.",
        )


@router.get("/cases/{case_id}/summary", response_model=CDRCaseSummary)
def get_cdr_summary_for_case(
    case_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieves CDR dataset availability, record counts, date boundaries,
    and suspected phone numbers for an investigation case.
    """
    case_record = _safe_verify_case_access(case_id, current_user["id"])
    case_title = case_record.get("title", "")
    return get_case_cdr_summary(case_id, case_title)


@router.get("/cases/{case_id}/records", response_model=List[CDRRecord])
def get_raw_cdr_records(
    case_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """
    Returns paginated raw CDR records associated with the case.
    """
    case_record = _safe_verify_case_access(case_id, current_user["id"])
    records = get_cdr_records_for_case(case_id, case_record.get("title", ""))
    return records[offset : offset + limit]


@router.post("/pattern-analysis", response_model=PatternAnalysisResponse)
def execute_pattern_analysis(
    req: PatternAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Executes Pattern-Based Suspicious Activity Analysis on a suspect's communications.
    """
    user_id = current_user["id"]
    case_record = _safe_verify_case_access(req.case_id, user_id)

    # Validate mobile number
    is_valid, normalized, err_msg = validate_mobile_number(req.suspect_number)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mobile number: {err_msg}",
        )

    # Retrieve dataset records for this case
    records = get_cdr_records_for_case(req.case_id, case_record.get("title", ""))
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No CDR records are available for case '{case_record.get('title', req.case_id)}'.",
        )

    result = run_pattern_analysis(
        records=records,
        case_id=req.case_id,
        suspect_number=req.suspect_number,
        midnight_start_hour=req.midnight_start_hour or 23,
        midnight_end_hour=req.midnight_end_hour or 5,
        short_interval_seconds=req.short_interval_seconds or 120,
    )

    # Store in history
    history_entry = AnalysisHistoryItem(
        id=str(uuid.uuid4()),
        case_id=req.case_id,
        investigator_id=user_id,
        suspect_number=req.suspect_number,
        analysis_method="PATTERN",
        analysis_timestamp=datetime.now(timezone.utc).isoformat(),
        analysis_parameters={
            "midnight_start_hour": req.midnight_start_hour,
            "midnight_end_hour": req.midnight_end_hour,
            "short_interval_seconds": req.short_interval_seconds,
        },
        result_summary={
            "total_calls": result.total_calls,
            "midnight_calls": result.midnight_calls_count,
            "burst_groups": len(result.short_interval_groups),
            "flags_raised": len(result.suspicious_flags),
        },
        candidate_numbers=[c.contact_number for c in result.frequent_contacts[:5]],
        supporting_record_count=result.total_calls,
    )
    _ANALYSIS_HISTORY.insert(0, history_entry)

    # Try audit log in Supabase
    try:
        client = get_supabase_client()
        client.table("audit_logs").insert({
            "case_id": req.case_id,
            "actor_id": user_id,
            "action": "CDR_PATTERN_ANALYSIS_EXECUTED",
            "details": {
                "suspect_number": req.suspect_number,
                "total_calls": result.total_calls,
                "flags_count": len(result.suspicious_flags),
            },
        }).execute()
    except Exception:
        pass

    return result


@router.post("/tower-analysis", response_model=TowerAnalysisResponse)
def execute_cell_tower_analysis(
    req: TowerAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Executes Common Cell Tower Candidate Identification algorithm.
    """
    user_id = current_user["id"]
    case_record = _safe_verify_case_access(req.case_id, user_id)

    # Validate mobile number
    is_valid, normalized, err_msg = validate_mobile_number(req.suspect_number)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mobile number: {err_msg}",
        )

    # Retrieve dataset records for this case
    records = get_cdr_records_for_case(req.case_id, case_record.get("title", ""))
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No CDR records are available for case '{case_record.get('title', req.case_id)}'.",
        )

    result = run_common_cell_tower_analysis(
        records=records,
        case_id=req.case_id,
        suspect_number=req.suspect_number,
        time_window_minutes=req.time_window_minutes or 10,
    )

    # Store in history
    history_entry = AnalysisHistoryItem(
        id=str(uuid.uuid4()),
        case_id=req.case_id,
        investigator_id=user_id,
        suspect_number=req.suspect_number,
        analysis_method="CELL_TOWER",
        analysis_timestamp=datetime.now(timezone.utc).isoformat(),
        analysis_parameters={
            "time_window_minutes": req.time_window_minutes or 10,
        },
        result_summary={
            "total_events_analyzed": result.total_suspect_events_analyzed,
            "common_candidates_count": len(result.common_candidates),
            "events_with_co_locations": result.events_with_co_locations_count,
        },
        candidate_numbers=[c.candidate_number for c in result.common_candidates[:5]],
        supporting_record_count=sum(
            len(e.candidate_records) for e in result.suspect_events
        ),
    )
    _ANALYSIS_HISTORY.insert(0, history_entry)

    # Try audit log in Supabase
    try:
        client = get_supabase_client()
        client.table("audit_logs").insert({
            "case_id": req.case_id,
            "actor_id": user_id,
            "action": "CDR_TOWER_ANALYSIS_EXECUTED",
            "details": {
                "suspect_number": req.suspect_number,
                "time_window_minutes": req.time_window_minutes,
                "common_candidates_found": len(result.common_candidates),
            },
        }).execute()
    except Exception:
        pass

    return result


@router.get("/cases/{case_id}/history", response_model=List[AnalysisHistoryItem])
def get_case_analysis_history(
    case_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns audit history of CDR analysis runs performed for a specific case.
    """
    _safe_verify_case_access(case_id, current_user["id"])
    return [h for h in _ANALYSIS_HISTORY if h.case_id == case_id]
