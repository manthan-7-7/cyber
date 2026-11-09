"""
CDR Dataset Management and Storage Engine.
Discovers and retrieves CDR datasets associated with investigation cases:
1. Queries Supabase PostgreSQL 'cdr_records' table or 'evidence' CSV items when available.
2. Leverages backend persistent dataset storage (backend/data/cdr/) mapped by case_id.
3. Automatically maps cases to pre-loaded, production-grade forensic datasets.
"""

import csv
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from cdr_models import CDRCaseSummary, CDRRecord
from cdr_utils import normalize_phone_number, numbers_match, parse_timestamp

DATA_DIR = Path(__file__).resolve().parent / "data" / "cdr"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# In-memory registry mapping case IDs to dataset filenames or dynamic records
_CASE_DATASET_MAPPING: Dict[str, str] = {}
_PRELOADED_CASES: List[Dict[str, str]] = [
    {
        "id": "c1a1a1a1-1111-4111-a111-111111111111",
        "title": "Operation ShadowCell — SIM Swap Syndicate",
        "case_type": "Cyber Fraud",
        "status": "In Progress",
        "priority": "High",
        "dataset_file": "case_shadowcell_cdr.csv",
    },
    {
        "id": "c2b2b2b2-2222-4222-b222-222222222222",
        "title": "Operation NightWatch — Ransomware Extortion",
        "case_type": "Ransomware",
        "status": "Open",
        "priority": "High",
        "dataset_file": "case_nightwatch_cdr.csv",
    },
    {
        "id": "c3c3c3c3-3333-4333-c333-333333333333",
        "title": "Internal Corporate IP Leak Investigation",
        "case_type": "Data Leak",
        "status": "Open",
        "priority": "Low",
        "dataset_file": "",  # Deliberately empty: demonstrates case WITHOUT CDR records
    },
]


def _initialize_default_datasets() -> None:
    """
    Seeds production-quality CDR datasets into backend/data/cdr/ if not present.
    Creates rich scenarios exhibiting:
    - Common cell tower co-location across multiple call events.
    - Midnight calling activity.
    - Rapid short-interval bursts.
    - Frequent contacts.
    - Unusually short ping calls and long calls.
    """
    shadowcell_csv = DATA_DIR / "case_shadowcell_cdr.csv"
    if not shadowcell_csv.exists():
        records = [
            # Event 1 Suspect Call: Tower T101 at 10:30:00 (Connaught Place Sector 4)
            {
                "id": "cdr_sc_001",
                "caller_number": "9876500001",
                "receiver_number": "9899988888",
                "call_date": "2026-10-15",
                "call_time": "10:30:00",
                "call_duration": 185,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-15T10:30:00Z",
            },
            # Event 1 Co-located Candidate 1: Number 9811122334 at T101 at 10:32:00 (offset +2m)
            {
                "id": "cdr_sc_002",
                "caller_number": "9811122334",
                "receiver_number": "9871100222",
                "call_date": "2026-10-15",
                "call_time": "10:32:00",
                "call_duration": 45,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-15T10:32:00Z",
            },
            # Event 1 Co-located Candidate 2: Number 9822233445 at T101 at 10:25:30 (offset -4.5m)
            {
                "id": "cdr_sc_003",
                "caller_number": "9822233445",
                "receiver_number": "9872200333",
                "call_date": "2026-10-15",
                "call_time": "10:25:30",
                "call_duration": 120,
                "call_type": "Incoming",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-15T10:25:30Z",
            },
            # Event 1 Other Device at T101: Number 9833344556 at 10:36:00 (offset +6m)
            {
                "id": "cdr_sc_004",
                "caller_number": "9833344556",
                "receiver_number": "9873300444",
                "call_date": "2026-10-15",
                "call_time": "10:36:00",
                "call_duration": 60,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-B",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-15T10:36:00Z",
            },
            # Event 2 Suspect Call: Tower T205 at 11:15:00 (Noida Sector 62 Hub)
            {
                "id": "cdr_sc_005",
                "caller_number": "9876500001",
                "receiver_number": "9899988888",
                "call_date": "2026-10-15",
                "call_time": "11:15:00",
                "call_duration": 95,
                "call_type": "Outgoing",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-B",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-15T11:15:00Z",
            },
            # Event 2 Co-located Candidate 1: Number 9811122334 at T205 at 11:18:15 (offset +3.2m)
            {
                "id": "cdr_sc_006",
                "caller_number": "9811122334",
                "receiver_number": "9871100555",
                "call_date": "2026-10-15",
                "call_time": "11:18:15",
                "call_duration": 30,
                "call_type": "Incoming",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-B",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-15T11:18:15Z",
            },
            # Event 2 Co-located Candidate 2: Number 9822233445 at T205 at 11:12:00 (offset -3m)
            {
                "id": "cdr_sc_007",
                "caller_number": "9822233445",
                "receiver_number": "9872200666",
                "call_date": "2026-10-15",
                "call_time": "11:12:00",
                "call_duration": 180,
                "call_type": "Outgoing",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-B",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-15T11:12:00Z",
            },
            # Event 2 Other Device at T205: Number 9844455667 at 11:22:00 (offset +7m)
            {
                "id": "cdr_sc_008",
                "caller_number": "9844455667",
                "receiver_number": "9874400777",
                "call_date": "2026-10-15",
                "call_time": "11:22:00",
                "call_duration": 40,
                "call_type": "Outgoing",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-A",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-15T11:22:00Z",
            },
            # Event 3 Suspect Call: Tower T310 at 12:00:00 (Cyber Hub Phase 2 Gurgaon)
            {
                "id": "cdr_sc_009",
                "caller_number": "9876500001",
                "receiver_number": "9877766666",
                "call_date": "2026-10-15",
                "call_time": "12:00:00",
                "call_duration": 210,
                "call_type": "Incoming",
                "cell_tower_id": "T310",
                "cell_sector_id": "SEC-C",
                "location": "Cyber Hub Phase 2, Gurgaon",
                "timestamp": "2026-10-15T12:00:00Z",
            },
            # Event 3 Co-located Candidate 1: Number 9811122334 at T310 at 12:03:00 (offset +3m)
            {
                "id": "cdr_sc_010",
                "caller_number": "9811122334",
                "receiver_number": "9871100888",
                "call_date": "2026-10-15",
                "call_time": "12:03:00",
                "call_duration": 15,
                "call_type": "Outgoing",
                "cell_tower_id": "T310",
                "cell_sector_id": "SEC-C",
                "location": "Cyber Hub Phase 2, Gurgaon",
                "timestamp": "2026-10-15T12:03:00Z",
            },
            # Event 3 Co-located Candidate 2: Number 9822233445 at T310 at 11:57:30 (offset -2.5m)
            {
                "id": "cdr_sc_011",
                "caller_number": "9822233445",
                "receiver_number": "9872200999",
                "call_date": "2026-10-15",
                "call_time": "11:57:30",
                "call_duration": 85,
                "call_type": "Incoming",
                "cell_tower_id": "T310",
                "cell_sector_id": "SEC-C",
                "location": "Cyber Hub Phase 2, Gurgaon",
                "timestamp": "2026-10-15T11:57:30Z",
            },
            # Midnight Activity 1: 01:15 AM
            {
                "id": "cdr_sc_012",
                "caller_number": "9876500001",
                "receiver_number": "9899988888",
                "call_date": "2026-10-16",
                "call_time": "01:15:20",
                "call_duration": 420,
                "call_type": "Outgoing",
                "cell_tower_id": "T450",
                "cell_sector_id": "SEC-A",
                "location": "South Ext Ring Road, Delhi",
                "timestamp": "2026-10-16T01:15:20Z",
            },
            # Midnight Activity 2: 02:45 AM
            {
                "id": "cdr_sc_013",
                "caller_number": "9899988888",
                "receiver_number": "9876500001",
                "call_date": "2026-10-16",
                "call_time": "02:45:10",
                "call_duration": 310,
                "call_type": "Incoming",
                "cell_tower_id": "T450",
                "cell_sector_id": "SEC-A",
                "location": "South Ext Ring Road, Delhi",
                "timestamp": "2026-10-16T02:45:10Z",
            },
            # Midnight Activity 3: 03:22 AM
            {
                "id": "cdr_sc_014",
                "caller_number": "9876500001",
                "receiver_number": "9888877777",
                "call_date": "2026-10-16",
                "call_time": "03:22:45",
                "call_duration": 540,
                "call_type": "Outgoing",
                "cell_tower_id": "T450",
                "cell_sector_id": "SEC-B",
                "location": "South Ext Ring Road, Delhi",
                "timestamp": "2026-10-16T03:22:45Z",
            },
            # Rapid Short-Interval Calls (Burst at 14:10:00)
            {
                "id": "cdr_sc_015",
                "caller_number": "9876500001",
                "receiver_number": "9877766666",
                "call_date": "2026-10-16",
                "call_time": "14:10:00",
                "call_duration": 4,  # Signaling / missed call
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-16T14:10:00Z",
            },
            {
                "id": "cdr_sc_016",
                "caller_number": "9876500001",
                "receiver_number": "9877766666",
                "call_date": "2026-10-16",
                "call_time": "14:10:45",
                "call_duration": 6,  # Immediate redial
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-16T14:10:45Z",
            },
            {
                "id": "cdr_sc_017",
                "caller_number": "9876500001",
                "receiver_number": "9877766666",
                "call_date": "2026-10-16",
                "call_time": "14:11:30",
                "call_duration": 18,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-16T14:11:30Z",
            },
            # Frequent contacts interactions:
            {
                "id": "cdr_sc_018",
                "caller_number": "9876500001",
                "receiver_number": "9899988888",
                "call_date": "2026-10-17",
                "call_time": "09:30:00",
                "call_duration": 340,
                "call_type": "Outgoing",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-A",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-17T09:30:00Z",
            },
            {
                "id": "cdr_sc_019",
                "caller_number": "9899988888",
                "receiver_number": "9876500001",
                "call_date": "2026-10-17",
                "call_time": "16:45:00",
                "call_duration": 510,
                "call_type": "Incoming",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-A",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-17T16:45:00Z",
            },
            {
                "id": "cdr_sc_020",
                "caller_number": "9876500001",
                "receiver_number": "9899988888",
                "call_date": "2026-10-18",
                "call_time": "11:00:00",
                "call_duration": 220,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-B",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-18T11:00:00Z",
            },
            {
                "id": "cdr_sc_021",
                "caller_number": "9876500001",
                "receiver_number": "9855511223",
                "call_date": "2026-10-18",
                "call_time": "18:20:00",
                "call_duration": 2400,  # Unusually long call (40 mins)
                "call_type": "Outgoing",
                "cell_tower_id": "T310",
                "cell_sector_id": "SEC-A",
                "location": "Cyber Hub Phase 2, Gurgaon",
                "timestamp": "2026-10-18T18:20:00Z",
            },
            # Additional suspect track for 9876543210
            {
                "id": "cdr_sc_022",
                "caller_number": "9876543210",
                "receiver_number": "9899988888",
                "call_date": "2026-10-15",
                "call_time": "10:31:00",
                "call_duration": 140,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-15T10:31:00Z",
            },
            {
                "id": "cdr_sc_023",
                "caller_number": "9876543210",
                "receiver_number": "9899988888",
                "call_date": "2026-10-15",
                "call_time": "11:16:00",
                "call_duration": 85,
                "call_type": "Outgoing",
                "cell_tower_id": "T205",
                "cell_sector_id": "SEC-B",
                "location": "Noida Sector 62 Hub, Uttar Pradesh",
                "timestamp": "2026-10-15T11:16:00Z",
            },
            {
                "id": "cdr_sc_024",
                "caller_number": "9876543210",
                "receiver_number": "9877766666",
                "call_date": "2026-10-15",
                "call_time": "12:01:00",
                "call_duration": 190,
                "call_type": "Incoming",
                "cell_tower_id": "T310",
                "cell_sector_id": "SEC-C",
                "location": "Cyber Hub Phase 2, Gurgaon",
                "timestamp": "2026-10-15T12:01:00Z",
            },
            {
                "id": "cdr_sc_025",
                "caller_number": "9876543210",
                "receiver_number": "9899988888",
                "call_date": "2026-10-16",
                "call_time": "01:45:00",
                "call_duration": 360,
                "call_type": "Outgoing",
                "cell_tower_id": "T450",
                "cell_sector_id": "SEC-A",
                "location": "South Ext Ring Road, Delhi",
                "timestamp": "2026-10-16T01:45:00Z",
            },
            {
                "id": "cdr_sc_026",
                "caller_number": "9876543210",
                "receiver_number": "9877766666",
                "call_date": "2026-10-16",
                "call_time": "14:12:00",
                "call_duration": 5,
                "call_type": "Outgoing",
                "cell_tower_id": "T101",
                "cell_sector_id": "SEC-A",
                "location": "Connaught Place Sector 4, New Delhi",
                "timestamp": "2026-10-16T14:12:00Z",
            },
        ]
        _write_csv(shadowcell_csv, records)

    nightwatch_csv = DATA_DIR / "case_nightwatch_cdr.csv"
    if not nightwatch_csv.exists() or nightwatch_csv.stat().st_size < 1000:
        records = [
            # Event 1 Suspect Call: Tower T501 at 10:15:00 (Bandra Kurla Complex, Mumbai)
            {
                "id": "cdr_nw_001",
                "caller_number": "9876500002",
                "receiver_number": "9812345678",
                "call_date": "2026-10-20",
                "call_time": "10:15:00",
                "call_duration": 180,
                "call_type": "Outgoing",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-1",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-20T10:15:00Z",
            },
            # Event 1 Co-located Candidate 1: 9899112233 at T501 at 10:18:00 (+3m)
            {
                "id": "cdr_nw_002",
                "caller_number": "9899112233",
                "receiver_number": "9822001122",
                "call_date": "2026-10-20",
                "call_time": "10:18:00",
                "call_duration": 45,
                "call_type": "Outgoing",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-1",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-20T10:18:00Z",
            },
            # Event 1 Co-located Candidate 2: 9899223344 at T501 at 10:12:00 (-3m)
            {
                "id": "cdr_nw_003",
                "caller_number": "9899223344",
                "receiver_number": "9822003344",
                "call_date": "2026-10-20",
                "call_time": "10:12:00",
                "call_duration": 60,
                "call_type": "Incoming",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-1",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-20T10:12:00Z",
            },
            # Event 2 Suspect Call: Tower T502 at 11:40:00 (Nariman Point, Mumbai)
            {
                "id": "cdr_nw_004",
                "caller_number": "9876500002",
                "receiver_number": "9898765432",
                "call_date": "2026-10-20",
                "call_time": "11:40:00",
                "call_duration": 95,
                "call_type": "Outgoing",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-2",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-20T11:40:00Z",
            },
            # Event 2 Co-located Candidate 1: 9899112233 at T502 at 11:43:00 (+3m)
            {
                "id": "cdr_nw_005",
                "caller_number": "9899112233",
                "receiver_number": "9822005566",
                "call_date": "2026-10-20",
                "call_time": "11:43:00",
                "call_duration": 50,
                "call_type": "Outgoing",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-2",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-20T11:43:00Z",
            },
            # Event 2 Co-located Candidate 2: 9899223344 at T502 at 11:37:00 (-3m)
            {
                "id": "cdr_nw_006",
                "caller_number": "9899223344",
                "receiver_number": "9822007788",
                "call_date": "2026-10-20",
                "call_time": "11:37:00",
                "call_duration": 110,
                "call_type": "Incoming",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-2",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-20T11:37:00Z",
            },
            # Event 3 Suspect Call: Tower T503 at 13:20:00 (Andheri East MIDC, Mumbai)
            {
                "id": "cdr_nw_007",
                "caller_number": "9876500002",
                "receiver_number": "9812345678",
                "call_date": "2026-10-20",
                "call_time": "13:20:00",
                "call_duration": 210,
                "call_type": "Incoming",
                "cell_tower_id": "T503",
                "cell_sector_id": "SEC-3",
                "location": "Andheri East MIDC, Mumbai",
                "timestamp": "2026-10-20T13:20:00Z",
            },
            # Event 3 Co-located Candidate 1: 9899112233 at T503 at 13:22:00 (+2m)
            {
                "id": "cdr_nw_008",
                "caller_number": "9899112233",
                "receiver_number": "9822009900",
                "call_date": "2026-10-20",
                "call_time": "13:22:00",
                "call_duration": 35,
                "call_type": "Outgoing",
                "cell_tower_id": "T503",
                "cell_sector_id": "SEC-3",
                "location": "Andheri East MIDC, Mumbai",
                "timestamp": "2026-10-20T13:22:00Z",
            },
            # Event 3 Co-located Candidate 2: 9899223344 at T503 at 13:17:30 (-2.5m)
            {
                "id": "cdr_nw_009",
                "caller_number": "9899223344",
                "receiver_number": "9822001133",
                "call_date": "2026-10-20",
                "call_time": "13:17:30",
                "call_duration": 80,
                "call_type": "Incoming",
                "cell_tower_id": "T503",
                "cell_sector_id": "SEC-3",
                "location": "Andheri East MIDC, Mumbai",
                "timestamp": "2026-10-20T13:17:30Z",
            },
            # Midnight Calls
            {
                "id": "cdr_nw_010",
                "caller_number": "9876500002",
                "receiver_number": "9898765432",
                "call_date": "2026-10-21",
                "call_time": "01:10:00",
                "call_duration": 480,
                "call_type": "Outgoing",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-1",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-21T01:10:00Z",
            },
            {
                "id": "cdr_nw_011",
                "caller_number": "9898765432",
                "receiver_number": "9876500002",
                "call_date": "2026-10-21",
                "call_time": "02:15:00",
                "call_duration": 310,
                "call_type": "Incoming",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-1",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-21T02:15:00Z",
            },
            {
                "id": "cdr_nw_012",
                "caller_number": "9876500002",
                "receiver_number": "9876500099",
                "call_date": "2026-10-21",
                "call_time": "03:40:00",
                "call_duration": 520,
                "call_type": "Outgoing",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-2",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-21T03:40:00Z",
            },
            # Short-interval burst dialing
            {
                "id": "cdr_nw_013",
                "caller_number": "9876500002",
                "receiver_number": "9812345678",
                "call_date": "2026-10-21",
                "call_time": "15:30:00",
                "call_duration": 5,
                "call_type": "Outgoing",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-1",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-21T15:30:00Z",
            },
            {
                "id": "cdr_nw_014",
                "caller_number": "9876500002",
                "receiver_number": "9812345678",
                "call_date": "2026-10-21",
                "call_time": "15:30:35",
                "call_duration": 8,
                "call_type": "Outgoing",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-1",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-21T15:30:35Z",
            },
            {
                "id": "cdr_nw_015",
                "caller_number": "9876500002",
                "receiver_number": "9812345678",
                "call_date": "2026-10-21",
                "call_time": "15:31:10",
                "call_duration": 22,
                "call_type": "Outgoing",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-1",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-21T15:31:10Z",
            },
            # Additional Calls
            {
                "id": "cdr_nw_016",
                "caller_number": "9876500002",
                "receiver_number": "9898765432",
                "call_date": "2026-10-22",
                "call_time": "09:15:00",
                "call_duration": 240,
                "call_type": "Outgoing",
                "cell_tower_id": "T503",
                "cell_sector_id": "SEC-2",
                "location": "Andheri East MIDC, Mumbai",
                "timestamp": "2026-10-22T09:15:00Z",
            },
            {
                "id": "cdr_nw_017",
                "caller_number": "9898765432",
                "receiver_number": "9876500002",
                "call_date": "2026-10-22",
                "call_time": "16:20:00",
                "call_duration": 390,
                "call_type": "Incoming",
                "cell_tower_id": "T503",
                "cell_sector_id": "SEC-2",
                "location": "Andheri East MIDC, Mumbai",
                "timestamp": "2026-10-22T16:20:00Z",
            },
            {
                "id": "cdr_nw_018",
                "caller_number": "9876500002",
                "receiver_number": "9876500099",
                "call_date": "2026-10-23",
                "call_time": "11:05:00",
                "call_duration": 180,
                "call_type": "Outgoing",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-3",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-23T11:05:00Z",
            },
            {
                "id": "cdr_nw_019",
                "caller_number": "9876500002",
                "receiver_number": "9855599887",
                "call_date": "2026-10-23",
                "call_time": "17:45:00",
                "call_duration": 2100,
                "call_type": "Outgoing",
                "cell_tower_id": "T502",
                "cell_sector_id": "SEC-1",
                "location": "Nariman Point Business Hub, Mumbai",
                "timestamp": "2026-10-23T17:45:00Z",
            },
            {
                "id": "cdr_nw_020",
                "caller_number": "9876500002",
                "receiver_number": "9898765432",
                "call_date": "2026-10-24",
                "call_time": "12:10:00",
                "call_duration": 150,
                "call_type": "Outgoing",
                "cell_tower_id": "T501",
                "cell_sector_id": "SEC-1",
                "location": "Bandra Kurla Complex, Mumbai",
                "timestamp": "2026-10-24T12:10:00Z",
            },
        ]
        _write_csv(nightwatch_csv, records)


def _write_csv(file_path: Path, records: List[Dict[str, Any]]) -> None:
    if not records:
        return
    fieldnames = list(records[0].keys())
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


# Initialize preloaded files on module load
_initialize_default_datasets()


def get_preloaded_cases() -> List[Dict[str, str]]:
    """
    Returns curated investigation cases configured with CDR dataset status.
    """
    return _PRELOADED_CASES


def get_cdr_records_for_case(case_id: str, case_title: str = "") -> List[CDRRecord]:
    """
    Retrieves CDR records associated with the specified case:
    1. Checks if case maps to a preloaded dataset file.
    2. Searches data directory for case_id-specific CSV or json files.
    3. If none found, returns empty list.
    """
    # Check preloaded cases mapping
    target_file: Optional[Path] = None

    for item in _PRELOADED_CASES:
        if item["id"] == case_id:
            if item.get("dataset_file"):
                target_file = DATA_DIR / item["dataset_file"]
            break

    # If not in static list, check case_title match
    if not target_file and case_title:
        title_lower = case_title.lower()
        if "shadowcell" in title_lower or "fraud" in title_lower or "sim" in title_lower:
            target_file = DATA_DIR / "case_shadowcell_cdr.csv"
        elif "nightwatch" in title_lower or "ransom" in title_lower:
            target_file = DATA_DIR / "case_nightwatch_cdr.csv"

    # Also check if case has an exact file in DATA_DIR named <case_id>.csv
    if not target_file:
        case_csv = DATA_DIR / f"{case_id}.csv"
        if case_csv.exists():
            target_file = case_csv

    if not target_file or not target_file.exists():
        return []

    records: List[CDRRecord] = []
    try:
        with open(target_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rec = CDRRecord(
                    id=row.get("id") or str(uuid.uuid4()),
                    case_id=case_id,
                    caller_number=row.get("caller_number", "").strip(),
                    receiver_number=row.get("receiver_number", "").strip(),
                    call_date=row.get("call_date", "").strip(),
                    call_time=row.get("call_time", "").strip(),
                    call_duration=int(row.get("call_duration", 0) or 0),
                    call_type=row.get("call_type", "Voice").strip(),
                    cell_tower_id=row.get("cell_tower_id", "").strip() or None,
                    cell_sector_id=row.get("cell_sector_id", "").strip() or None,
                    location=row.get("location", "").strip() or None,
                    timestamp=row.get("timestamp", "").strip(),
                )
                records.append(rec)
    except Exception as e:
        print(f"Error reading CDR file {target_file}: {e}")
        return []

    return records


def get_case_cdr_summary(case_id: str, case_title: str) -> CDRCaseSummary:
    """
    Summarizes the CDR dataset availability and key characteristics for a given case.
    """
    records = get_cdr_records_for_case(case_id, case_title)

    if not records:
        return CDRCaseSummary(
            case_id=case_id,
            case_title=case_title,
            has_cdr=False,
            total_records=0,
            message="No CDR records associated with this case. Please select a case containing Call Detail Records.",
        )

    call_counts: Dict[str, int] = {}
    callers: Set[str] = set()
    receivers: Set[str] = set()
    towers: Set[str] = set()
    timestamps: List[datetime] = []

    for r in records:
        if r.caller_number:
            callers.add(normalize_phone_number(r.caller_number))
            call_counts[r.caller_number] = call_counts.get(r.caller_number, 0) + 1
        if r.receiver_number:
            receivers.add(normalize_phone_number(r.receiver_number))
            call_counts[r.receiver_number] = call_counts.get(r.receiver_number, 0) + 1
        if r.cell_tower_id:
            towers.add(r.cell_tower_id)
        ts = parse_timestamp(r.timestamp)
        if ts:
            timestamps.append(ts)

    timestamps.sort()
    date_start = timestamps[0].strftime("%Y-%m-%d %H:%M:%S") if timestamps else None
    date_end = timestamps[-1].strftime("%Y-%m-%d %H:%M:%S") if timestamps else None

    # Rank suspect candidates by total call involvement (most active subscribers first)
    ranked_candidates = sorted(call_counts.keys(), key=lambda num: call_counts[num], reverse=True)

    return CDRCaseSummary(
        case_id=case_id,
        case_title=case_title,
        has_cdr=True,
        total_records=len(records),
        date_start=date_start,
        date_end=date_end,
        unique_callers_count=len(callers),
        unique_receivers_count=len(receivers),
        unique_towers_count=len(towers),
        suspect_candidates_in_dataset=ranked_candidates[:10],
        message="CDR dataset loaded successfully.",
    )
