"""
Pattern-Based Suspicious Activity Analysis Engine (Module 2).
Performs deterministic, rule-based forensic analysis on CDR records for a selected
suspect number within an authorized investigation case.

Core Analytics:
1. Midnight Calling Patterns (23:00 to 05:00).
2. Frequent Calling Patterns & Contact Rankings.
3. Short-Interval / Burst Calling Detection.
4. Call Duration Outlier Analysis (signaling vs prolonged calls).
5. Directional Communication Breakdown (Incoming vs Outgoing).
6. Suspicious Indicator Flags with Forensically Grounded Explanations.
"""

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from cdr_models import (
    CDRRecord,
    FlagSeverity,
    FrequentContact,
    PatternAnalysisResponse,
    ShortIntervalCallGroup,
    SuspiciousFlag,
)
from cdr_utils import (
    format_duration,
    normalize_phone_number,
    numbers_match,
    parse_timestamp,
)


def run_pattern_analysis(
    records: List[CDRRecord],
    case_id: str,
    suspect_number: str,
    midnight_start_hour: int = 23,
    midnight_end_hour: int = 5,
    short_interval_seconds: int = 120,
) -> PatternAnalysisResponse:
    """
    Executes comprehensive pattern-based analysis on the suspect's communications.
    """
    normalized_suspect = normalize_phone_number(suspect_number)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Step 1: Filter records where the suspect is either caller or receiver
    suspect_records: List[CDRRecord] = []
    for r in records:
        if numbers_match(r.caller_number, suspect_number) or numbers_match(
            r.receiver_number, suspect_number
        ):
            suspect_records.append(r)

    # If suspect has no records in this case, return clean response with explanation
    if not suspect_records:
        return PatternAnalysisResponse(
            case_id=case_id,
            suspect_mobile_number=suspect_number,
            normalized_suspect_number=normalized_suspect,
            analysis_timestamp=now_iso,
            total_calls=0,
            incoming_calls=0,
            outgoing_calls=0,
            missed_calls=0,
            sms_count=0,
            incoming_outgoing_ratio=None,
            average_call_duration_seconds=0.0,
            total_call_duration_seconds=0,
            midnight_calls_count=0,
            midnight_calls=[],
            frequent_contacts=[],
            short_interval_calls_count=0,
            short_interval_groups=[],
            unusually_short_calls_count=0,
            unusually_long_calls_count=0,
            suspicious_flags=[
                SuspiciousFlag(
                    id="flag_no_records",
                    severity=FlagSeverity.INFO,
                    title="No Associated CDR Activity Found",
                    description=(
                        f"Suspect number {suspect_number} does not appear as either caller "
                        f"or receiver in this case's CDR dataset ({len(records)} total records examined)."
                    ),
                    supporting_records_count=0,
                    supporting_records=[],
                )
            ],
        )

    # Sort suspect records chronologically
    def record_sort_key(r: CDRRecord) -> float:
        ts = parse_timestamp(r.timestamp)
        return ts.timestamp() if ts else 0.0

    suspect_records.sort(key=record_sort_key)

    # Metrics collectors
    incoming_count = 0
    outgoing_count = 0
    missed_count = 0
    sms_count = 0
    total_duration = 0

    midnight_calls: List[Dict[str, Any]] = []
    contacts_map: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "total_calls": 0,
            "incoming_calls": 0,
            "outgoing_calls": 0,
            "total_duration": 0,
            "interactions": [],
        }
    )

    unusually_short_records: List[Dict[str, Any]] = []
    unusually_long_records: List[Dict[str, Any]] = []

    # Iterate over all suspect records to calculate metrics
    for r in suspect_records:
        is_caller = numbers_match(r.caller_number, suspect_number)
        counterpart = r.receiver_number if is_caller else r.caller_number
        counterpart_clean = normalize_phone_number(counterpart)

        call_type_lower = r.call_type.lower()
        if "sms" in call_type_lower:
            sms_count += 1
        elif "missed" in call_type_lower:
            missed_count += 1
        elif is_caller:
            outgoing_count += 1
        else:
            incoming_count += 1

        total_duration += r.call_duration

        # Outlier duration checks
        rec_summary = {
            "id": r.id,
            "timestamp": r.timestamp,
            "caller": r.caller_number,
            "receiver": r.receiver_number,
            "duration": r.call_duration,
            "duration_formatted": format_duration(r.call_duration),
            "call_type": r.call_type,
            "tower_id": r.cell_tower_id,
            "location": r.location,
        }

        if r.call_duration <= 10 and "sms" not in call_type_lower:
            unusually_short_records.append(rec_summary)
        elif r.call_duration >= 1800:  # 30+ minutes
            unusually_long_records.append(rec_summary)

        # Midnight call detection (e.g. >= 23:00 or < 05:00)
        ts = parse_timestamp(r.timestamp)
        if ts:
            hour = ts.hour
            is_midnight = False
            if midnight_start_hour > midnight_end_hour:
                is_midnight = hour >= midnight_start_hour or hour < midnight_end_hour
            else:
                is_midnight = midnight_start_hour <= hour < midnight_end_hour

            if is_midnight:
                midnight_calls.append(rec_summary)

        # Contact statistics
        c_stats = contacts_map[counterpart]
        c_stats["total_calls"] += 1
        if is_caller:
            c_stats["outgoing_calls"] += 1
        else:
            c_stats["incoming_calls"] += 1
        c_stats["total_duration"] += r.call_duration
        c_stats["interactions"].append(r.timestamp)

    # Process frequent contacts
    frequent_contacts: List[FrequentContact] = []
    for contact_num, data in contacts_map.items():
        total_c = data["total_calls"]
        total_dur = data["total_duration"]
        avg_dur = round(total_dur / total_c, 1) if total_c > 0 else 0.0
        sorted_ts = sorted(data["interactions"])
        frequent_contacts.append(
            FrequentContact(
                contact_number=contact_num,
                total_calls=total_c,
                incoming_calls=data["incoming_calls"],
                outgoing_calls=data["outgoing_calls"],
                total_duration_seconds=total_dur,
                average_duration_seconds=avg_dur,
                first_interaction=sorted_ts[0] if sorted_ts else "",
                last_interaction=sorted_ts[-1] if sorted_ts else "",
            )
        )

    # Rank contacts by total calls, then total duration
    frequent_contacts.sort(
        key=lambda x: (x.total_calls, x.total_duration_seconds), reverse=True
    )

    # Step 3: Short-Interval Calling Analysis (Bursts)
    short_interval_groups: List[ShortIntervalCallGroup] = []
    current_burst: List[CDRRecord] = []

    for i in range(len(suspect_records)):
        rec = suspect_records[i]
        if not current_burst:
            current_burst.append(rec)
            continue

        prev_rec = current_burst[-1]
        ts_curr = parse_timestamp(rec.timestamp)
        ts_prev = parse_timestamp(prev_rec.timestamp)

        if ts_curr and ts_prev:
            delta = abs((ts_curr - ts_prev).total_seconds())
            if delta <= short_interval_seconds:
                current_burst.append(rec)
            else:
                if len(current_burst) >= 2:
                    first_ts = parse_timestamp(current_burst[0].timestamp)
                    last_ts = parse_timestamp(current_burst[-1].timestamp)
                    span = int(abs((last_ts - first_ts).total_seconds())) if (first_ts and last_ts) else 0
                    short_interval_groups.append(
                        ShortIntervalCallGroup(
                            group_id=f"burst_{len(short_interval_groups) + 1}",
                            reason=(
                                f"{len(current_burst)} consecutive calls placed within {span} seconds "
                                f"(threshold: {short_interval_seconds}s between successive calls)."
                            ),
                            calls_count=len(current_burst),
                            time_window_seconds=span,
                            records=[
                                {
                                    "id": b.id,
                                    "timestamp": b.timestamp,
                                    "caller": b.caller_number,
                                    "receiver": b.receiver_number,
                                    "duration": b.call_duration,
                                    "tower_id": b.cell_tower_id,
                                    "type": b.call_type,
                                }
                                for b in current_burst
                            ],
                        )
                    )
                current_burst = [rec]
        else:
            current_burst = [rec]

    # Check last burst group
    if len(current_burst) >= 2:
        first_ts = parse_timestamp(current_burst[0].timestamp)
        last_ts = parse_timestamp(current_burst[-1].timestamp)
        span = int(abs((last_ts - first_ts).total_seconds())) if (first_ts and last_ts) else 0
        short_interval_groups.append(
            ShortIntervalCallGroup(
                group_id=f"burst_{len(short_interval_groups) + 1}",
                reason=(
                    f"{len(current_burst)} consecutive calls placed within {span} seconds "
                    f"(threshold: {short_interval_seconds}s between successive calls)."
                ),
                calls_count=len(current_burst),
                time_window_seconds=span,
                records=[
                    {
                        "id": b.id,
                        "timestamp": b.timestamp,
                        "caller": b.caller_number,
                        "receiver": b.receiver_number,
                        "duration": b.call_duration,
                        "tower_id": b.cell_tower_id,
                        "type": b.call_type,
                    }
                    for b in current_burst
                ],
            )
        )

    short_interval_total_calls = sum(g.calls_count for g in short_interval_groups)

    # Step 4: Summary calculations
    total_calls_count = len(suspect_records)
    avg_duration = (
        round(total_duration / total_calls_count, 1) if total_calls_count > 0 else 0.0
    )
    in_out_ratio = (
        round(incoming_count / outgoing_count, 2)
        if outgoing_count > 0
        else (float(incoming_count) if incoming_count > 0 else None)
    )

    # Step 5: Generate Suspicious Pattern Flags with Detailed Explanations
    suspicious_flags: List[SuspiciousFlag] = []

    # Flag 1: Midnight Activity
    if len(midnight_calls) >= 2:
        suspicious_flags.append(
            SuspiciousFlag(
                id="flag_midnight_calls",
                severity=FlagSeverity.HIGH if len(midnight_calls) >= 4 else FlagSeverity.MEDIUM,
                title="Unusual Midnight Communications Detected",
                description=(
                    f"Identified {len(midnight_calls)} calls placed between {midnight_start_hour:02d}:00 "
                    f"and {midnight_end_hour:02d}:00. Midnight communication patterns frequently correlate "
                    f"with covert coordination or operations outside normal business hours."
                ),
                supporting_records_count=len(midnight_calls),
                supporting_records=midnight_calls[:10],
            )
        )

    # Flag 2: Short-Interval Burst Calls
    if short_interval_groups:
        total_burst_calls = sum(g.calls_count for g in short_interval_groups)
        suspicious_flags.append(
            SuspiciousFlag(
                id="flag_rapid_bursts",
                severity=FlagSeverity.HIGH if total_burst_calls >= 4 else FlagSeverity.MEDIUM,
                title="Rapid Short-Interval Calling Bursts",
                description=(
                    f"Detected {len(short_interval_groups)} burst cluster(s) totaling {total_burst_calls} calls "
                    f"where successive calls occurred within {short_interval_seconds} seconds. "
                    f"Rapid bursts may indicate signaling protocols, auto-dialers, or urgent operational triggering."
                ),
                supporting_records_count=total_burst_calls,
                supporting_records=[r for g in short_interval_groups for r in g.records][:10],
            )
        )

    # Flag 3: Unusually Short Calls (Signaling / Pings)
    if len(unusually_short_records) >= 3:
        suspicious_flags.append(
            SuspiciousFlag(
                id="flag_short_ping_calls",
                severity=FlagSeverity.MEDIUM,
                title="Frequent Extremely Short Calls (Signaling)",
                description=(
                    f"Identified {len(unusually_short_records)} call(s) lasting 10 seconds or less. "
                    f"High frequencies of ultra-short calls can indicate missed-call signaling, "
                    f"number validation, or switchboard evasion."
                ),
                supporting_records_count=len(unusually_short_records),
                supporting_records=unusually_short_records[:10],
            )
        )

    # Flag 4: High Contact Concentration
    if frequent_contacts and frequent_contacts[0].total_calls >= 10:
        top_c = frequent_contacts[0]
        suspicious_flags.append(
            SuspiciousFlag(
                id="flag_top_contact_concentration",
                severity=FlagSeverity.MEDIUM,
                title="Disproportionate Contact Concentration",
                description=(
                    f"Target communicated with {top_c.contact_number} {top_c.total_calls} times "
                    f"({round((top_c.total_calls / total_calls_count) * 100, 1)}% of all calls), "
                    f"totaling {format_duration(top_c.total_duration_seconds)} of talk time."
                ),
                supporting_records_count=top_c.total_calls,
                supporting_records=[],
            )
        )

    # Flag 5: Asymmetric One-Way Calling
    if outgoing_count >= 10 and incoming_count == 0:
        suspicious_flags.append(
            SuspiciousFlag(
                id="flag_asymmetric_outbound",
                severity=FlagSeverity.LOW,
                title="Strictly One-Way Outbound Calling Pattern",
                description=(
                    f"Suspect placed {outgoing_count} outgoing calls with 0 incoming calls received. "
                    f"Exclusively outbound patterns suggest dispatch activity or telemarketing/spam."
                ),
                supporting_records_count=outgoing_count,
                supporting_records=[],
            )
        )

    # Baseline Flag if no anomalies found
    if not suspicious_flags:
        suspicious_flags.append(
            SuspiciousFlag(
                id="flag_normal_patterns",
                severity=FlagSeverity.INFO,
                title="Standard Communication Patterns",
                description=(
                    f"Analysis of {total_calls_count} calls showed no statistically significant midnight activity, "
                    f"rapid bursts, or severe duration anomalies matching suspicious thresholds."
                ),
                supporting_records_count=total_calls_count,
                supporting_records=[],
            )
        )

    return PatternAnalysisResponse(
        case_id=case_id,
        suspect_mobile_number=suspect_number,
        normalized_suspect_number=normalized_suspect,
        analysis_timestamp=now_iso,
        total_calls=total_calls_count,
        incoming_calls=incoming_count,
        outgoing_calls=outgoing_count,
        missed_calls=missed_count,
        sms_count=sms_count,
        incoming_outgoing_ratio=in_out_ratio,
        average_call_duration_seconds=avg_duration,
        total_call_duration_seconds=total_duration,
        midnight_calls_count=len(midnight_calls),
        midnight_calls=midnight_calls,
        frequent_contacts=frequent_contacts,
        short_interval_calls_count=short_interval_total_calls,
        short_interval_groups=short_interval_groups,
        unusually_short_calls_count=len(unusually_short_records),
        unusually_long_calls_count=len(unusually_long_records),
        suspicious_flags=suspicious_flags,
    )
