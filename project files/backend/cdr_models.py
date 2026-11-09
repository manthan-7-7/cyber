"""
CDR Data Models and Schemas
Defines structured Pydantic models for Call Detail Records, Pattern Analysis,
Common Cell Tower Analysis, and Investigation History.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class CallType(str, Enum):
    INCOMING = "Incoming"
    OUTGOING = "Outgoing"
    MISSED = "Missed"
    SMS = "SMS"


class FlagSeverity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class CDRRecord(BaseModel):
    id: str
    case_id: str
    caller_number: str
    receiver_number: str
    call_date: str
    call_time: str
    call_duration: int = Field(ge=0, description="Duration in seconds")
    call_type: str = "Voice"
    cell_tower_id: Optional[str] = None
    cell_sector_id: Optional[str] = None
    location: Optional[str] = None
    timestamp: str


class CDRCaseSummary(BaseModel):
    case_id: str
    case_title: str
    has_cdr: bool
    total_records: int
    date_start: Optional[str] = None
    date_end: Optional[str] = None
    unique_callers_count: int = 0
    unique_receivers_count: int = 0
    unique_towers_count: int = 0
    suspect_candidates_in_dataset: List[str] = []
    message: Optional[str] = None


class PatternAnalysisRequest(BaseModel):
    case_id: str
    suspect_number: str
    midnight_start_hour: Optional[int] = Field(23, ge=0, le=23)
    midnight_end_hour: Optional[int] = Field(5, ge=0, le=23)
    short_interval_seconds: Optional[int] = Field(120, ge=10, le=3600)

    @field_validator("suspect_number")
    @classmethod
    def validate_suspect_number(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Suspect mobile number is required.")
        return trimmed


class SuspiciousFlag(BaseModel):
    id: str
    severity: FlagSeverity
    title: str
    description: str
    supporting_records_count: int
    supporting_records: List[Dict[str, Any]] = []


class FrequentContact(BaseModel):
    contact_number: str
    total_calls: int
    incoming_calls: int
    outgoing_calls: int
    total_duration_seconds: int
    average_duration_seconds: float
    first_interaction: str
    last_interaction: str


class ShortIntervalCallGroup(BaseModel):
    group_id: str
    reason: str
    calls_count: int
    time_window_seconds: int
    records: List[Dict[str, Any]]


class PatternAnalysisResponse(BaseModel):
    case_id: str
    suspect_mobile_number: str
    normalized_suspect_number: str
    analysis_timestamp: str
    total_calls: int
    incoming_calls: int
    outgoing_calls: int
    missed_calls: int
    sms_count: int
    incoming_outgoing_ratio: Optional[float] = None
    average_call_duration_seconds: float
    total_call_duration_seconds: int
    midnight_calls_count: int
    midnight_calls: List[Dict[str, Any]] = []
    frequent_contacts: List[FrequentContact] = []
    short_interval_calls_count: int
    short_interval_groups: List[ShortIntervalCallGroup] = []
    unusually_short_calls_count: int
    unusually_long_calls_count: int
    suspicious_flags: List[SuspiciousFlag] = []
    disclaimer: str = (
        "Notice: Analytical indicators identify communication anomalies for forensic decision "
        "support and do not constitute independent proof of criminal activity."
    )


class TowerAnalysisRequest(BaseModel):
    case_id: str
    suspect_number: str
    time_window_minutes: Optional[int] = Field(10, ge=1, le=120)

    @field_validator("suspect_number")
    @classmethod
    def validate_suspect_number(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Suspect mobile number is required.")
        return trimmed


class TowerEventCandidate(BaseModel):
    candidate_number: str
    candidate_call_time: str
    time_offset_minutes: float
    candidate_call_type: str
    candidate_duration: int
    tower_id: str
    sector_id: Optional[str] = None
    record_id: str


class SuspectCallEvent(BaseModel):
    event_index: int
    record_id: str
    event_timestamp: str
    call_type: str
    duration: int
    counterpart_number: str
    cell_tower_id: str
    cell_sector_id: Optional[str] = None
    location: Optional[str] = None
    candidate_numbers_observed: List[str] = []
    candidate_records: List[TowerEventCandidate] = []


class RankedCandidate(BaseModel):
    rank: int
    candidate_number: str
    matched_events_count: int
    total_suspect_events: int
    match_percentage: float
    distinct_towers_matched_count: int
    distinct_towers: List[str]
    sector_consistency_count: int
    average_time_offset_minutes: float
    ranking_score: float
    supporting_events: List[Dict[str, Any]] = []
    classification: str = "Potential Association — Requires Investigator Verification"


class TowerAnalysisResponse(BaseModel):
    case_id: str
    suspect_mobile_number: str
    normalized_suspect_number: str
    analysis_timestamp: str
    configured_time_window_minutes: int
    total_suspect_events_analyzed: int
    events_with_co_locations_count: int
    suspect_events: List[SuspectCallEvent] = []
    total_unique_candidates_observed: int
    common_candidates: List[RankedCandidate] = []
    data_quality_warning: Optional[str] = None
    disclaimer: str = (
        "Potential Association — Requires Investigator Verification. "
        "Co-location at cell towers does not independently prove association, "
        "device ownership, or criminal activity."
    )


class AnalysisHistoryItem(BaseModel):
    id: str
    case_id: str
    investigator_id: str
    suspect_number: str
    analysis_method: str  # "PATTERN" or "CELL_TOWER"
    analysis_timestamp: str
    analysis_parameters: Dict[str, Any]
    result_summary: Dict[str, Any]
    candidate_numbers: List[str] = []
    supporting_record_count: int
