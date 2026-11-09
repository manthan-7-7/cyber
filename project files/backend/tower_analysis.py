"""
Common Cell Tower Analysis & Suspect Identification Engine (Module 2, Phase 5).
Implements a multi-event spatio-temporal candidate identification algorithm:
1. Identifies call events associated with the suspect number that have recorded cell towers.
2. Extracts co-located devices/numbers observed around each event's tower within a configurable time window.
3. Performs cross-event candidate set intersection.
4. Computes multi-factor forensic candidate rankings.
5. Returns event-level supporting records and clearly distinguishes CDR facts from inferred associations.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from cdr_models import (
    CDRRecord,
    RankedCandidate,
    SuspectCallEvent,
    TowerAnalysisResponse,
    TowerEventCandidate,
)
from cdr_utils import (
    normalize_phone_number,
    numbers_match,
    parse_timestamp,
)


def run_common_cell_tower_analysis(
    records: List[CDRRecord],
    case_id: str,
    suspect_number: str,
    time_window_minutes: int = 10,
) -> TowerAnalysisResponse:
    """
    Executes the multi-event cell tower co-location candidate identification algorithm.
    """
    normalized_suspect = normalize_phone_number(suspect_number)
    now_iso = datetime.now(timezone.utc).isoformat()
    window_seconds = time_window_minutes * 60

    # Step 1: Identify suspect call events that have cell tower observations
    suspect_events_raw: List[CDRRecord] = []
    for r in records:
        if numbers_match(r.caller_number, suspect_number) or numbers_match(
            r.receiver_number, suspect_number
        ):
            if r.cell_tower_id and r.cell_tower_id.strip():
                suspect_events_raw.append(r)

    # Chronologically sort suspect events
    def get_record_dt(r: CDRRecord) -> Optional[datetime]:
        return parse_timestamp(r.timestamp)

    suspect_events_raw.sort(key=lambda r: (get_record_dt(r) or datetime.min).timestamp())

    # Case: Suspect has no recorded tower events in this case
    if not suspect_events_raw:
        total_suspect_calls = sum(
            1
            for r in records
            if numbers_match(r.caller_number, suspect_number)
            or numbers_match(r.receiver_number, suspect_number)
        )
        warning_msg = (
            f"The suspect number {suspect_number} has {total_suspect_calls} call(s) in this case, "
            f"but none contain valid cell tower identifiers (cell_tower_id). Tower correlation cannot be performed."
            if total_suspect_calls > 0
            else f"Suspect number {suspect_number} does not appear in this case's CDR dataset."
        )
        return TowerAnalysisResponse(
            case_id=case_id,
            suspect_mobile_number=suspect_number,
            normalized_suspect_number=normalized_suspect,
            analysis_timestamp=now_iso,
            configured_time_window_minutes=time_window_minutes,
            total_suspect_events_analyzed=0,
            events_with_co_locations_count=0,
            suspect_events=[],
            total_unique_candidates_observed=0,
            common_candidates=[],
            data_quality_warning=warning_msg,
        )

    # Step 2 & 3: For each suspect event, discover other mobile numbers observed around the tower
    event_details: List[SuspectCallEvent] = []
    # candidate_tracker: candidate_number -> list of dicts with match details
    candidate_matches: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    all_observed_candidate_numbers: Set[str] = set()
    events_with_co_locations = 0

    for idx, s_rec in enumerate(suspect_events_raw, start=1):
        s_dt = get_record_dt(s_rec)
        if not s_dt:
            continue

        is_caller = numbers_match(s_rec.caller_number, suspect_number)
        counterpart = s_rec.receiver_number if is_caller else s_rec.caller_number

        event_candidates: List[TowerEventCandidate] = []
        event_candidate_nums: Set[str] = set()

        # Search the entire dataset for co-located records at the same tower within time window
        for other_rec in records:
            # Exclude the exact same suspect record
            if other_rec.id == s_rec.id:
                continue

            # Check if this record took place at the same cell tower
            if not other_rec.cell_tower_id or other_rec.cell_tower_id.strip() != s_rec.cell_tower_id.strip():
                continue

            # Compare timestamps
            o_dt = get_record_dt(other_rec)
            if not o_dt:
                continue

            delta_sec = (o_dt - s_dt).total_seconds()
            if abs(delta_sec) <= window_seconds:
                # Find devices involved in other_rec that are NOT the suspect
                involved_numbers = []
                if not numbers_match(other_rec.caller_number, suspect_number):
                    involved_numbers.append(other_rec.caller_number)
                if not numbers_match(other_rec.receiver_number, suspect_number):
                    involved_numbers.append(other_rec.receiver_number)

                for cand_num in set(involved_numbers):
                    cand_clean = normalize_phone_number(cand_num)
                    if not cand_clean or cand_clean == normalized_suspect:
                        continue

                    time_offset_min = round(delta_sec / 60.0, 2)
                    tc = TowerEventCandidate(
                        candidate_number=cand_num,
                        candidate_call_time=other_rec.timestamp,
                        time_offset_minutes=time_offset_min,
                        candidate_call_type=other_rec.call_type,
                        candidate_duration=other_rec.call_duration,
                        tower_id=other_rec.cell_tower_id,
                        sector_id=other_rec.cell_sector_id,
                        record_id=other_rec.id,
                    )
                    event_candidates.append(tc)
                    event_candidate_nums.add(cand_num)
                    all_observed_candidate_numbers.add(cand_num)

                    # Check sector match
                    sector_match = False
                    if s_rec.cell_sector_id and other_rec.cell_sector_id:
                        sector_match = s_rec.cell_sector_id.strip().upper() == other_rec.cell_sector_id.strip().upper()

                    candidate_matches[cand_num].append({
                        "event_index": idx,
                        "suspect_event_id": s_rec.id,
                        "suspect_time": s_rec.timestamp,
                        "candidate_time": other_rec.timestamp,
                        "tower_id": s_rec.cell_tower_id,
                        "suspect_sector": s_rec.cell_sector_id,
                        "candidate_sector": other_rec.cell_sector_id,
                        "sector_match": sector_match,
                        "time_offset_minutes": time_offset_min,
                        "abs_time_offset_minutes": abs(time_offset_min),
                        "candidate_call_type": other_rec.call_type,
                        "candidate_duration": other_rec.call_duration,
                    })

        if event_candidates:
            events_with_co_locations += 1

        event_details.append(
            SuspectCallEvent(
                event_index=idx,
                record_id=s_rec.id,
                event_timestamp=s_rec.timestamp,
                call_type=s_rec.call_type,
                duration=s_rec.call_duration,
                counterpart_number=counterpart,
                cell_tower_id=s_rec.cell_tower_id,
                cell_sector_id=s_rec.cell_sector_id,
                location=s_rec.location,
                candidate_numbers_observed=sorted(list(event_candidate_nums)),
                candidate_records=event_candidates,
            )
        )

    total_events = len(event_details)

    # Step 4 & 5: Cross-Event Candidate Set Comparison & Multi-Factor Scoring
    ranked_candidates: List[RankedCandidate] = []

    for cand_num, matches in candidate_matches.items():
        # Deduplicate matches by event_index so each event is counted once
        events_matched_set = {m["event_index"] for m in matches}
        matched_events_count = len(events_matched_set)
        match_percentage = round((matched_events_count / total_events) * 100.0, 1) if total_events > 0 else 0.0

        distinct_towers = sorted(list({m["tower_id"] for m in matches}))
        sector_matches_count = sum(1 for m in matches if m.get("sector_match"))

        avg_offset = round(
            sum(m["abs_time_offset_minutes"] for m in matches) / len(matches), 2
        ) if matches else 0.0

        # Multi-Factor Ranking Score (0.0 to 100.0)
        # 1. Event recurrence ratio (50 points): matched_events / total_events
        recurrence_weight = (matched_events_count / total_events) * 50.0

        # 2. Tower diversity (25 points): matching across distinct physical towers
        tower_diversity_weight = min(len(distinct_towers) * 12.5, 25.0)

        # 3. Sector consistency (15 points)
        sector_weight = min(sector_matches_count * 7.5, 15.0)

        # 4. Temporal proximity (10 points): closer calls receive higher proximity weight
        # If avg_offset is 0 min -> 10 pts, if avg_offset >= window -> 0 pts
        proximity_ratio = max(0.0, 1.0 - (avg_offset / float(time_window_minutes)))
        proximity_weight = proximity_ratio * 10.0

        ranking_score = round(
            recurrence_weight + tower_diversity_weight + sector_weight + proximity_weight,
            1
        )

        ranked_candidates.append(
            RankedCandidate(
                rank=0,  # Assigned after sorting
                candidate_number=cand_num,
                matched_events_count=matched_events_count,
                total_suspect_events=total_events,
                match_percentage=match_percentage,
                distinct_towers_matched_count=len(distinct_towers),
                distinct_towers=distinct_towers,
                sector_consistency_count=sector_matches_count,
                average_time_offset_minutes=avg_offset,
                ranking_score=ranking_score,
                supporting_events=matches,
                classification="Potential Association — Requires Investigator Verification",
            )
        )

    # Sort candidates by:
    # 1. matched_events_count (descending)
    # 2. ranking_score (descending)
    # 3. average_time_offset_minutes (ascending)
    ranked_candidates.sort(
        key=lambda c: (c.matched_events_count, c.ranking_score, -c.average_time_offset_minutes),
        reverse=True,
    )

    # Assign ranks
    for rank_idx, cand in enumerate(ranked_candidates, start=1):
        cand.rank = rank_idx

    # Data Quality Warning Evaluation
    data_quality_warning = None
    if len(all_observed_candidate_numbers) == 0:
        data_quality_warning = (
            "No co-located devices were identified at the suspect's cell towers within the "
            f"{time_window_minutes}-minute observation window. The case dataset may contain single-subscriber records "
            "rather than broad tower dump observations."
        )
    elif total_events < 2:
        data_quality_warning = (
            "Only 1 tower event is available for this suspect. High confidence cross-event recurrence "
            "requires observations across multiple distinct call events."
        )

    return TowerAnalysisResponse(
        case_id=case_id,
        suspect_mobile_number=suspect_number,
        normalized_suspect_number=normalized_suspect,
        analysis_timestamp=now_iso,
        configured_time_window_minutes=time_window_minutes,
        total_suspect_events_analyzed=total_events,
        events_with_co_locations_count=events_with_co_locations,
        suspect_events=event_details,
        total_unique_candidates_observed=len(all_observed_candidate_numbers),
        common_candidates=ranked_candidates,
        data_quality_warning=data_quality_warning,
    )
