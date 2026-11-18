# Iteration 4: Overview period filter (today/week/month/year/all/date) + sheet follow-up column regression
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")


def _env(key):
    with open("/app/backend/.env") as fh:
        for line in fh:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')


DB = MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]
PWD = "Surgiassist@2026"


def login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PWD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def owner():
    return login("owner@surgiassist.com")


@pytest.fixture(scope="module")
def bdm():
    return login("muskaan@surgiassist.com")


def ist_today():
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()


def expected_range(period):
    t = ist_today()
    if period == "today":
        return t, t
    if period == "week":
        s = t - timedelta(days=t.weekday())
        return s, s + timedelta(days=6)
    if period == "month":
        s = t.replace(day=1)
        return s, (s + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    if period == "year":
        return t.replace(month=1, day=1), t.replace(month=12, day=31)


def db_count(start, end, extra=None):
    q = {"is_test": False, "office_date": {"$gte": start, "$lte": end}}
    q.update(extra or {})
    return DB.leads.count_documents(q)


def get_ov(h, **params):
    return requests.get(f"{BASE_URL}/api/overview", params=params, headers=h, timeout=60)


# Period ranges + consistency of every section
@pytest.mark.parametrize("period", ["today", "week", "month", "year"])
def test_period_ranges_and_section_consistency(owner, period):
    r = get_ov(owner, period=period)
    assert r.status_code == 200, r.text
    d = r.json()
    s, e = expected_range(period)
    assert d["period"] == period
    assert d["start"] == s.isoformat() and d["end"] == e.isoformat()
    exp = db_count(d["start"], d["end"])
    assert d["total_leads"] == exp == d["day"]["arrived"] == d["leads_on_date"]
    assert d["day"]["assigned"] + d["day"]["unassigned"] == exp
    assert sum(x["count"] for x in d["by_treatment"]) == exp
    assert sum(x["count"] for x in d["by_stage"]) == exp
    assert sum(x["total"] for x in d["leaderboard"]) == exp
    assert d["day"]["unassigned"] == db_count(d["start"], d["end"], {"bdm": ""})
    assert d["trend_unit"] == ("month" if period == "year" else "day")
    if period in ("week", "month"):
        assert sum(t["count"] for t in d["trend"]) == exp
        assert all(d["start"] <= t["date"] <= d["end"] for t in d["trend"])
    print(period, d["start"], d["end"], exp)


def test_default_period_is_today(owner):
    d = get_ov(owner).json()
    assert d["period"] == "today" and d["start"] == d["end"] == ist_today().isoformat()


def test_all_time(owner):
    d = get_ov(owner, period="all").json()
    total = DB.leads.count_documents({"is_test": False})
    assert d["start"] == "" and d["total_leads"] == total == d["all_time_leads"]
    assert sum(x["total"] for x in d["leaderboard"]) == total


def test_single_date(owner):
    d = get_ov(owner, period="date", date="2026-11-17").json()
    assert d["start"] == d["end"] == "2026-11-17"
    exp = db_count("2026-11-17", "2026-11-17")
    assert d["total_leads"] == exp and sum(x["count"] for x in d["by_stage"]) == exp
    # leads list for same date should match
    lr = requests.get(f"{BASE_URL}/api/leads", params={"date": "2026-11-17", "limit": 1}, headers=owner, timeout=30).json()
    assert lr["total"] == exp


@pytest.mark.parametrize("params", [{"period": "date"}, {"period": "bogus"}, {"period": "date", "date": "2026-13-45"}])
def test_bad_params_400(owner, params):
    r = get_ov(owner, **params)
    assert r.status_code == 400, r.text


def test_bdm_scope(bdm):
    for p in ["today", "month", "all"]:
        d = get_ov(bdm, period=p).json()
        assert d["leaderboard"] == []
        assert d["day"]["unassigned"] == 0
        if d["start"]:
            exp = db_count(d["start"], d["end"], {"bdm": "Muskaan"})
        else:
            exp = DB.leads.count_documents({"is_test": False, "bdm": "Muskaan"})
        assert d["total_leads"] == exp
        assert all(b["bdm"] == "Muskaan" for b in d["day"]["by_bdm"])


# Sheet sync regression: follow up dates read by position after Status
def test_sheet_rows_blank_followup_header():
    sys.path.insert(0, "/app/backend")
    from server import sheet_rows
    rows = sheet_rows("Name,Status,,Other\nA,Hot,2026-11-20,x\n")
    assert rows[0]["follow up date"] == "2026-11-20"
    rows = sheet_rows("Name,Status,Follow Up Date\nA,Hot,2026-11-21\n")
    assert rows[0]["follow up date"] == "2026-11-21"


def test_overdue_due_nonzero(owner):
    d = get_ov(owner).json()
    print("overdue", d["overdue"], "due_today", d["due_today"])
    assert d["overdue"] > 0 and d["due_today"] > 0
    assert DB.leads.count_documents({"is_test": False, "follow_up_date": {"$ne": ""}}) > 0
