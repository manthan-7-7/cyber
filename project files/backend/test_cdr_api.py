"""
Comprehensive Integration Test Suite for CDR Analysis & Suspect Identification Module.
Tests all scenarios required by Phase 9 of the master prompt.
"""

import sys
from pathlib import Path

# Add paths
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))
sys.path.insert(0, r"C:\vedaleo\.venv\Lib\site-packages")

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

CASE_SHADOWCELL = "c1a1a1a1-1111-4111-a111-111111111111"
CASE_EMPTY = "c3c3c3c3-3333-4333-c333-333333333333"
SUSPECT_NUMBER = "9876500001"
DEV_TOKEN = "dev_session_token_investigator_001"
HEADERS = {"Authorization": f"Bearer {DEV_TOKEN}"}

results = {}

def report(test_id, name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    results[test_id] = (name, status, detail)
    print(f"[{status}] {test_id}: {name} - {detail}")

print("\n=== STARTING CDR MODULE COMPREHENSIVE TESTS ===\n")

# 1. Health & Root endpoints
try:
    r = client.get("/health")
    assert r.status_code == 200 and r.json().get("status") == "ok"
    report("HEALTH-1", "Backend health endpoint check", True, "200 OK")
except Exception as e:
    report("HEALTH-1", "Backend health endpoint check", False, str(e))

# 2. Authentication: Login
try:
    r = client.post("/api/auth/login", json={"email": "investigator_test@example.com", "password": "Password123!"})
    assert r.status_code == 200
    token = r.json().get("access_token")
    assert token is not None
    report("AUTH-1", "Investigator login", True, f"Token returned: {token[:15]}...")
except Exception as e:
    report("AUTH-1", "Investigator login", False, str(e))

# 3. Session verification /api/auth/me
try:
    r = client.get("/api/auth/me", headers=HEADERS)
    assert r.status_code == 200
    user = r.json().get("user", {})
    assert user.get("id") is not None
    report("AUTH-2", "Session verification /api/auth/me", True, f"User {user.get('email')} verified")
except Exception as e:
    report("AUTH-2", "Session verification /api/auth/me", False, str(e))

# 4. List cases
try:
    r = client.get("/api/cases", headers=HEADERS)
    assert r.status_code == 200
    cases = r.json()
    assert len(cases) >= 3
    case_ids = [c["id"] for c in cases]
    assert CASE_SHADOWCELL in case_ids and CASE_EMPTY in case_ids
    report("CASES-1", "Case listing includes investigation cases", True, f"Found {len(cases)} cases")
except Exception as e:
    report("CASES-1", "Case listing includes investigation cases", False, str(e))

# 5. CDR Case Summary for case WITH CDR
try:
    r = client.get(f"/api/cdr/cases/{CASE_SHADOWCELL}/summary", headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["has_cdr"] is True
    assert data["total_records"] > 0
    assert SUSPECT_NUMBER in [c.replace(" ", "") for c in data["suspect_candidates_in_dataset"]]
    report("CDR-SUM-1", "CDR Case Summary for case WITH data", True, f"{data['total_records']} records, {data['unique_towers_count']} towers")
except Exception as e:
    report("CDR-SUM-1", "CDR Case Summary for case WITH data", False, str(e))

# 6. CDR Case Summary for case WITHOUT CDR
try:
    r = client.get(f"/api/cdr/cases/{CASE_EMPTY}/summary", headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["has_cdr"] is False
    assert data["total_records"] == 0
    report("CDR-SUM-2", "CDR Case Summary for case WITHOUT data", True, "Correctly reported has_cdr=False, 0 records")
except Exception as e:
    report("CDR-SUM-2", "CDR Case Summary for case WITHOUT data", False, str(e))

# 7. Pattern Analysis - Valid Execution
try:
    payload = {
        "case_id": CASE_SHADOWCELL,
        "suspect_number": "+91 98765 00001",  # Test with formatting / international prefix
        "midnight_start_hour": 23,
        "midnight_end_hour": 5,
        "short_interval_seconds": 120,
    }
    r = client.post("/api/cdr/pattern-analysis", json=payload, headers=HEADERS)
    assert r.status_code == 200
    res = r.json()
    assert res["total_calls"] > 0
    assert res["midnight_calls_count"] >= 3
    assert len(res["frequent_contacts"]) > 0
    assert len(res["suspicious_flags"]) > 0
    # Verify suspicious flag explanations exist
    for flag in res["suspicious_flags"]:
        assert len(flag["title"]) > 0
        assert len(flag["description"]) > 0
    report("PATTERN-1", "Pattern analysis execution on valid suspect", True, f"{res['total_calls']} calls, {res['midnight_calls_count']} midnight calls, {len(res['suspicious_flags'])} flags")
except Exception as e:
    report("PATTERN-1", "Pattern analysis execution on valid suspect", False, str(e))

# 8. Pattern Analysis - Invalid Mobile Number (400)
try:
    payload = {
        "case_id": CASE_SHADOWCELL,
        "suspect_number": "invalid-phone-abc",
    }
    r = client.post("/api/cdr/pattern-analysis", json=payload, headers=HEADERS)
    assert r.status_code == 400
    report("PATTERN-2", "Pattern analysis rejects invalid mobile number (400)", True, f"Status {r.status_code}: {r.json().get('detail')}")
except Exception as e:
    report("PATTERN-2", "Pattern analysis rejects invalid mobile number (400)", False, str(e))

# 9. Pattern Analysis - Case Without CDR (404)
try:
    payload = {
        "case_id": CASE_EMPTY,
        "suspect_number": "9876500001",
    }
    r = client.post("/api/cdr/pattern-analysis", json=payload, headers=HEADERS)
    assert r.status_code == 404
    report("PATTERN-3", "Pattern analysis on case without CDR returns 404", True, f"Status {r.status_code}: {r.json().get('detail')}")
except Exception as e:
    report("PATTERN-3", "Pattern analysis on case without CDR returns 404", False, str(e))

# 10. Common Cell Tower Analysis - Valid Execution
try:
    payload = {
        "case_id": CASE_SHADOWCELL,
        "suspect_number": "09876500001",  # Test with leading 0
        "time_window_minutes": 10,
    }
    r = client.post("/api/cdr/tower-analysis", json=payload, headers=HEADERS)
    assert r.status_code == 200
    res = r.json()
    assert res["total_suspect_events_analyzed"] >= 3
    assert len(res["common_candidates"]) >= 2

    # Check top candidate
    top_cand = res["common_candidates"][0]
    assert top_cand["matched_events_count"] >= 3
    assert len(top_cand["distinct_towers"]) == 3
    assert "Requires Investigator Verification" in top_cand["classification"]

    report("TOWER-1", "Common cell tower candidate identification algorithm", True, f"{res['total_suspect_events_analyzed']} events analyzed, {len(res['common_candidates'])} common candidates ranked")
except Exception as e:
    report("TOWER-1", "Common cell tower candidate identification algorithm", False, str(e))

# 11. Common Cell Tower Analysis - Number with no tower records
try:
    payload = {
        "case_id": CASE_SHADOWCELL,
        "suspect_number": "9999999999",  # Number not in dataset
        "time_window_minutes": 10,
    }
    r = client.post("/api/cdr/tower-analysis", json=payload, headers=HEADERS)
    assert r.status_code == 200
    res = r.json()
    assert res["total_suspect_events_analyzed"] == 0
    assert res["data_quality_warning"] is not None
    report("TOWER-2", "Tower analysis handles number without tower records", True, f"Warning: {res['data_quality_warning']}")
except Exception as e:
    report("TOWER-2", "Tower analysis handles number without tower records", False, str(e))

# 12. Security: Unauthorized requests without token rejected (401)
try:
    r1 = client.get(f"/api/cdr/cases/{CASE_SHADOWCELL}/summary")
    r2 = client.post("/api/cdr/pattern-analysis", json={"case_id": CASE_SHADOWCELL, "suspect_number": "9876500001"})
    r3 = client.post("/api/cdr/tower-analysis", json={"case_id": CASE_SHADOWCELL, "suspect_number": "9876500001"})
    assert r1.status_code == 401 and r2.status_code == 401 and r3.status_code == 401
    report("SEC-1", "All CDR endpoints reject unauthenticated requests with 401", True, "401 Unauthorized enforced")
except Exception as e:
    report("SEC-1", "All CDR endpoints reject unauthenticated requests with 401", False, str(e))

# 13. Security: Unauthorized access to non-existent or inaccessible case (404)
try:
    fake_case = "99999999-9999-4999-9999-999999999999"
    r = client.get(f"/api/cdr/cases/{fake_case}/summary", headers=HEADERS)
    assert r.status_code == 404
    report("SEC-2", "Non-existent case returns privacy-preserving 404", True, "404 Not Found")
except Exception as e:
    report("SEC-2", "Non-existent case returns privacy-preserving 404", False, str(e))

# 14. Analysis History endpoint
try:
    r = client.get(f"/api/cdr/cases/{CASE_SHADOWCELL}/history", headers=HEADERS)
    assert r.status_code == 200
    hist = r.json()
    assert len(hist) >= 2  # Pattern and Tower analyses run above
    report("HIST-1", "Analysis history logs and retrieves past runs", True, f"{len(hist)} history items recorded")
except Exception as e:
    report("HIST-1", "Analysis history logs and retrieves past runs", False, str(e))

# 15. Raw CDR Records Paginated
try:
    r = client.get(f"/api/cdr/cases/{CASE_SHADOWCELL}/records?limit=5&offset=0", headers=HEADERS)
    assert r.status_code == 200
    recs = r.json()
    assert len(recs) == 5
    report("RECORDS-1", "Raw CDR records endpoint with pagination", True, f"Retrieved {len(recs)} records")
except Exception as e:
    report("RECORDS-1", "Raw CDR records endpoint with pagination", False, str(e))

print("\n=== TEST RESULTS SUMMARY ===")
all_passed = True
for tid, (name, status, detail) in sorted(results.items()):
    print(f"[{status}] {tid}: {name}")
    if status != "PASS":
        all_passed = False

print(f"\nFinal Verdict: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")
sys.exit(0 if all_passed else 1)
