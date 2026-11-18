# Iteration 3 features: office-day logic, overview day block, attendance + allocation, cron endpoints,
# WhatsApp digest (MOCKED outbox), campaign report, follow-up done w/ next date, change password, BDM RBAC
import os
import sys
import uuid
from datetime import datetime, timedelta

import pytest
import requests

sys.path.insert(0, "/app/backend")
from normalize import office_day  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PW = "Surgiassist@2026"
OWNER, MANAGER, BDM = "owner@surgiassist.com", "manager@surgiassist.com", "muskaan@surgiassist.com"


def _secret():
    for line in open("/app/backend/.env"):
        if line.startswith("WEBHOOK_CRON_SECRET="):
            return line.split("=", 1)[1].strip().strip('"')


def login(email, password=PW):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)


def client(email, password=PW):
    r = login(email, password)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def owner():
    return client(OWNER)


@pytest.fixture(scope="module")
def bdm():
    return client(BDM)


@pytest.fixture(scope="module")
def today(owner):
    return owner.get(f"{BASE_URL}/api/meta", timeout=30).json()["today"]


# ---------- office day (unit) ----------
class TestOfficeDay:
    @pytest.mark.parametrize("created,exp_date,exp_after", [
        ("2026-11-17T18:00:00", "2026-11-18", True), ("2026-11-17T23:59:59", "2026-11-18", True),
        ("2026-11-18T00:00:00", "2026-11-18", False), ("2026-11-18T09:59:00", "2026-11-18", False),
        ("2026-11-18T17:59:59", "2026-11-18", False), ("2026-12-31T19:00:00", "2027-01-01", True), ("", "", False)])
    def test_office_day(self, created, exp_date, exp_after):
        assert office_day(created) == (exp_date, exp_after)

    def test_leads_office_date_consistent(self, owner, today):
        d = owner.get(f"{BASE_URL}/api/leads", params={"limit": 200}, timeout=30).json()
        for i in d["items"]:
            if i.get("created_at"):
                assert (i["office_date"], i["after_hours"]) == office_day(i["created_at"]), i["id"]


# ---------- overview day block ----------
class TestOverviewDay:
    def test_day_block_matches_leads(self, owner, today):
        ov = owner.get(f"{BASE_URL}/api/overview", params={"date": today}, timeout=30).json()
        day = ov["day"]
        assert day["arrived"] == day["assigned"] + day["unassigned"]
        assert sum(b["count"] for b in day["by_bdm"]) == day["assigned"]
        total = owner.get(f"{BASE_URL}/api/leads", params={"date": today, "limit": 1}, timeout=30).json()["total"]
        assert total == day["arrived"]
        un = owner.get(f"{BASE_URL}/api/leads", params={"date": today, "bdm": "Unassigned", "limit": 1}, timeout=30).json()["total"]
        assert un == day["unassigned"]
        if day["by_bdm"]:
            b = day["by_bdm"][0]
            n = owner.get(f"{BASE_URL}/api/leads", params={"date": today, "bdm": b["bdm"], "limit": 1}, timeout=30).json()["total"]
            assert n == b["count"]


# ---------- RBAC ----------
class TestRbacNew:
    def test_bdm_forbidden(self, bdm):
        for m, path in [("get", "/api/reports/campaigns"), ("get", "/api/whatsapp/outbox"), ("post", "/api/whatsapp/digest/run"), ("get", "/api/attendance")]:
            assert getattr(bdm, m)(f"{BASE_URL}{path}", timeout=30).status_code == 403, path
        assert bdm.put(f"{BASE_URL}/api/attendance", json={"date": "2026-11-18", "off": []}, timeout=30).status_code == 403


# ---------- cron ----------
class TestCron:
    @pytest.mark.parametrize("job", ["morning-allocation", "whatsapp-digest"])
    def test_cron_auth(self, job):
        url = f"{BASE_URL}/api/cron/{job}"
        assert requests.post(url, json={}, timeout=30).status_code == 401
        assert requests.post(url, json={}, headers={"Authorization": "Bearer wrong"}, timeout=30).status_code == 401

    def test_cron_dedupe(self, owner):
        rid = f"TEST_run_{uuid.uuid4().hex[:8]}"
        h = {"Authorization": f"Bearer {_secret()}", "X-Webhook-Id": rid}
        before = len([a for a in owner.get(f"{BASE_URL}/api/audit", params={"limit": 1000}, timeout=30).json() if a["action"] == "whatsapp.digest"])
        r1 = requests.post(f"{BASE_URL}/api/cron/whatsapp-digest", json={}, headers=h, timeout=30)
        r2 = requests.post(f"{BASE_URL}/api/cron/whatsapp-digest", json={}, headers=h, timeout=30)
        assert r1.status_code == 200 and r1.json() == {"accepted": True}
        assert r2.status_code == 200 and r2.json() == {"accepted": True}
        import time
        time.sleep(4)
        after = len([a for a in owner.get(f"{BASE_URL}/api/audit", params={"limit": 1000}, timeout=30).json() if a["action"] == "whatsapp.digest"])
        assert after - before == 1

    def test_cron_empty_body(self):
        # platform cron may POST without a body
        r = requests.post(f"{BASE_URL}/api/cron/whatsapp-digest", headers={"Authorization": f"Bearer {_secret()}", "X-Webhook-Id": f"TEST_{uuid.uuid4().hex[:6]}"}, timeout=30)
        assert r.status_code == 200, r.text


# ---------- whatsapp (MOCKED) ----------
class TestWhatsApp:
    def test_digest_run_and_outbox(self, owner, today):
        att = owner.get(f"{BASE_URL}/api/attendance", params={"date": today}, timeout=30).json()
        present = [b["bdm"] for b in att["bdms"] if b["present"]]
        r = owner.post(f"{BASE_URL}/api/whatsapp/digest/run", timeout=60).json()
        assert r["date"] == today and r["sent"] == 0 and r["messages"] == len(present)
        ob = owner.get(f"{BASE_URL}/api/whatsapp/outbox", params={"date": today}, timeout=30).json()
        assert ob["connected"] is False
        items = {i["bdm"]: i for i in ob["items"]}
        assert set(present) <= set(items)
        m = items["Muskaan"]
        assert m["status"] == "not_sent" and "Due today" in m["message"]
        fu = owner.get(f"{BASE_URL}/api/followups", params={"date": today, "bdm": "Muskaan"}, timeout=30).json()["summary"]
        assert m["due"] == fu["due"] and m["overdue"] == fu["overdue"]
        assert owner.get(f"{BASE_URL}/api/whatsapp/outbox", params={"date": "bad"}, timeout=30).status_code == 400


# ---------- campaign report ----------
class TestReport:
    def test_campaigns(self, owner):
        rows = owner.get(f"{BASE_URL}/api/reports/campaigns", timeout=30).json()
        assert len(rows) > 0
        for r in rows:
            assert r["hot"] + r["opd"] + r["lost"] <= r["total"] and r["surgeries"] <= r["opd"]
            assert r["conversion"] == round(r["surgeries"] / r["total"] * 100, 2)
        total = owner.get(f"{BASE_URL}/api/overview", params={"period": "all"}, timeout=30).json()["total_leads"]
        assert sum(r["total"] for r in rows) == total
        assert any(r["variant"] in ("NW", "BIDD", "LL") for r in rows)


# ---------- attendance + allocation ----------
class TestAttendanceAllocation:
    def test_off_bdms_skipped(self, owner, today):
        orig_att = owner.get(f"{BASE_URL}/api/attendance", params={"date": today}, timeout=30).json()
        orig_off = [b["bdm"] for b in orig_att["bdms"] if not b["present"]]
        alloc = owner.get(f"{BASE_URL}/api/allocation", timeout=30).json()
        orig_alloc = {"auto_assign": alloc["auto_assign"], "rules": alloc["rules"]}
        lead = owner.get(f"{BASE_URL}/api/leads", params={"stage": "Follow Up", "limit": 1, "page": 7}, timeout=30).json()["items"][0]
        lid, orig_bdm = lead["id"], lead["bdm"]
        bdms = [r["bdm"] for r in alloc["rules"]]
        present = [b for b in bdms if b == "Muskaan"] or bdms[:1]
        off = [b for b in bdms if b not in present]
        try:
            assert owner.put(f"{BASE_URL}/api/attendance", json={"date": today, "off": off}, timeout=30).status_code == 200
            got = owner.get(f"{BASE_URL}/api/attendance", params={"date": today}, timeout=30).json()
            assert {b["bdm"] for b in got["bdms"] if not b["present"]} == set(off)
            rules = [{**r, "active": True, "daily_quota": 500} for r in alloc["rules"]]
            assert owner.put(f"{BASE_URL}/api/allocation", json={"auto_assign": False, "rules": rules}, timeout=30).status_code == 200
            owner.patch(f"{BASE_URL}/api/leads/{lid}", json={"bdm": "Unassigned"}, timeout=30)
            run = owner.post(f"{BASE_URL}/api/allocation/run", timeout=60).json()
            assert set(run["off_today"]) == set(off)
            assert set(run["by_bdm"]) <= set(present), run
            assert owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()["lead"]["bdm"] in present
        finally:
            owner.put(f"{BASE_URL}/api/attendance", json={"date": today, "off": orig_off}, timeout=30)
            owner.put(f"{BASE_URL}/api/allocation", json=orig_alloc, timeout=30)
            owner.patch(f"{BASE_URL}/api/leads/{lid}", json={"bdm": orig_bdm or "Unassigned"}, timeout=30)

    def test_future_office_date_not_assigned(self, owner, today):
        tomorrow = (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        fut = owner.get(f"{BASE_URL}/api/leads", params={"date": tomorrow, "bdm": "Unassigned", "limit": 50}, timeout=30).json()
        # Only meaningful when after-hours leads exist for tomorrow; run is not executed here to avoid data changes
        assert all(i["after_hours"] for i in fut["items"])

    def test_attendance_validation(self, owner):
        assert owner.put(f"{BASE_URL}/api/attendance", json={"date": "", "off": []}, timeout=30).status_code == 400
        assert owner.put(f"{BASE_URL}/api/attendance", json={"date": "2026-13-45", "off": []}, timeout=30).status_code == 400


# ---------- follow-up done ----------
class TestFollowupDone:
    def test_done_with_next_date_and_clear(self, owner):
        lead = owner.get(f"{BASE_URL}/api/leads", params={"stage": "Follow Up", "limit": 1, "page": 9}, timeout=30).json()["items"][0]
        lid, orig = lead["id"], lead["follow_up_date"]
        try:
            r = owner.post(f"{BASE_URL}/api/leads/{lid}/followup/complete", json={"next_date": "2026-12-05", "note": "TEST_called"}, timeout=30)
            assert r.status_code == 200
            det = owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()
            assert det["lead"]["follow_up_date"] == "2026-12-05"
            assert any("next on 2026-12-05" in a["text"] and "TEST_called" in a["text"] for a in det["activity"])
            assert owner.post(f"{BASE_URL}/api/leads/{lid}/followup/complete", json={"next_date": "", "note": ""}, timeout=30).status_code == 200
            assert owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()["lead"]["follow_up_date"] == ""
            assert owner.post(f"{BASE_URL}/api/leads/{lid}/followup/complete", json={"next_date": "05/12/2026"}, timeout=30).status_code == 400
        finally:
            owner.patch(f"{BASE_URL}/api/leads/{lid}", json={"follow_up_date": orig}, timeout=30)
            if not orig:
                pass


# ---------- change password (temp user) ----------
class TestChangePassword:
    def test_change_password_flow(self, owner):
        email = f"test_pw_{uuid.uuid4().hex[:6]}@example.com"
        u = owner.post(f"{BASE_URL}/api/users", json={"name": "TEST_Pw User", "email": email, "password": "OldPass123", "role": "BDM"}, timeout=30).json()
        try:
            s = client(email, "OldPass123")
            url = f"{BASE_URL}/api/auth/change-password"
            assert s.post(url, json={"current_password": "wrong", "new_password": "NewPass123"}, timeout=30).status_code == 400
            assert s.post(url, json={"current_password": "OldPass123", "new_password": "short"}, timeout=30).status_code == 422
            assert s.post(url, json={"current_password": "OldPass123", "new_password": "OldPass123"}, timeout=30).status_code == 400
            assert s.post(url, json={"current_password": "OldPass123", "new_password": "NewPass123"}, timeout=30).status_code == 200
            assert login(email, "OldPass123").status_code == 401
            assert login(email, "NewPass123").status_code == 200
            assert requests.post(url, json={"current_password": "a", "new_password": "NewPass1234"}, timeout=30).status_code == 401
        finally:
            owner.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=30)

    def test_user_phone(self, owner):
        email = f"test_ph_{uuid.uuid4().hex[:6]}@example.com"
        u = owner.post(f"{BASE_URL}/api/users", json={"name": "TEST_Ph", "email": email, "password": "OldPass123", "role": "BDM", "phone": "+91 98765-43210"}, timeout=30).json()
        try:
            assert u["phone"] == "919876543210"
            p = owner.patch(f"{BASE_URL}/api/users/{u['id']}", json={"phone": "91 11111 22222"}, timeout=30).json()
            assert p["phone"] == "911111122222"
        finally:
            owner.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=30)
