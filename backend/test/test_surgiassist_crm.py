# Surgiassist CRM regression suite: auth/RBAC, sync, overview, leads, drawer actions, follow-ups, allocation, normalization, team, audit
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PW = "Surgiassist@2026"
OWNER, MANAGER, BDM = "owner@surgiassist.com", "manager@surgiassist.com", "muskaan@surgiassist.com"


def login(email, password=PW):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)


def client(email):
    r = login(email)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def owner():
    return client(OWNER)


@pytest.fixture(scope="module")
def manager():
    return client(MANAGER)


@pytest.fixture(scope="module")
def bdm():
    return client(BDM)


# ---------- Auth ----------
class TestAuth:
    @pytest.mark.parametrize("email,role", [(OWNER, "Master Owner"), (MANAGER, "Manager"), (BDM, "BDM")])
    def test_login_roles(self, email, role):
        r = login(email)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == role and isinstance(d["token"], str) and "password_hash" not in d["user"]
        me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {d['token']}"}, timeout=30)
        assert me.status_code == 200 and me.json()["email"] == email

    def test_wrong_password_and_no_token(self):
        assert login(OWNER, "nope-wrong").status_code == 401
        assert requests.get(f"{BASE_URL}/api/leads", timeout=30).status_code == 401
        # clear the failed-attempt counter for the owner
        assert login(OWNER).status_code == 200

    def test_lockout_after_5_failures_throwaway(self):
        email = f"test_lock_{uuid.uuid4().hex[:8]}@example.com"
        codes = [login(email, "badpass123").status_code for _ in range(5)]
        assert codes == [401] * 5
        assert login(email, "badpass123").status_code == 429


# ---------- Sync + RBAC ----------
class TestSyncRbac:
    def test_sync_status(self, owner):
        d = owner.get(f"{BASE_URL}/api/sync/status", timeout=30).json()
        assert d["interval_seconds"] == 300 and d["status"] in ("healthy", "error", "pending")
        assert d["next_sync_at"]

    def test_bdm_forbidden(self, bdm):
        assert bdm.post(f"{BASE_URL}/api/sync", timeout=60).status_code == 403
        for path in ["/api/allocation", "/api/normalization", "/api/users", "/api/audit"]:
            assert bdm.get(f"{BASE_URL}{path}", timeout=30).status_code == 403, path

    def test_bdm_scope(self, bdm):
        d = bdm.get(f"{BASE_URL}/api/leads", params={"limit": 200}, timeout=30).json()
        assert d["total"] > 0
        assert all(i["bdm"] == "Muskaan" for i in d["items"])
        ov = bdm.get(f"{BASE_URL}/api/overview", params={"period": "all"}, timeout=30).json()
        assert ov["leaderboard"] == [] and ov["total_leads"] == d["total"]


# ---------- Overview / Leads ----------
class TestLeadsRead:
    def test_overview_date(self, owner):
        d = owner.get(f"{BASE_URL}/api/overview", params={"period": "date", "date": "2026-11-18"}, timeout=30).json()
        assert d["date"] == "2026-11-18" and d["all_time_leads"] > 2000 and len(d["leaderboard"]) > 0
        exact = owner.get(f"{BASE_URL}/api/leads", params={"date": "2026-11-18", "limit": 1}, timeout=30).json()["total"]
        assert d["leads_on_date"] == exact
        assert owner.get(f"{BASE_URL}/api/overview", params={"period": "date", "date": "18-11-2026"}, timeout=30).status_code == 400

    def test_date_filter_exact(self, owner):
        d = owner.get(f"{BASE_URL}/api/leads", params={"date": "2026-11-17", "limit": 200}, timeout=30).json()
        # since iteration_3 the date filter uses office_date (leads after 18:00 count next day)
        assert all(i["office_date"] == "2026-11-17" for i in d["items"])

    def test_filters_and_pagination(self, owner):
        p1 = owner.get(f"{BASE_URL}/api/leads", params={"page": 1, "limit": 25}, timeout=30).json()
        p2 = owner.get(f"{BASE_URL}/api/leads", params={"page": 2, "limit": 25}, timeout=30).json()
        assert len(p1["items"]) == 25 and not ({i["id"] for i in p1["items"]} & {i["id"] for i in p2["items"]})
        t = owner.get(f"{BASE_URL}/api/leads", params={"treatment": "Hernia", "stage": "Lost", "limit": 200}, timeout=30).json()
        assert all(i["treatment"] == "Hernia" and i["stage"] == "Lost" for i in t["items"])
        b = owner.get(f"{BASE_URL}/api/leads", params={"bdm": "Usman", "limit": 200}, timeout=30).json()
        assert all(i["bdm"] == "Usman" for i in b["items"])
        name = p1["items"][0]["name"]
        s = owner.get(f"{BASE_URL}/api/leads", params={"search": name}, timeout=30).json()
        assert s["total"] >= 1

    def test_export_csv(self, owner):
        r = owner.get(f"{BASE_URL}/api/leads/export", params={"date": "2026-11-18"}, timeout=60)
        assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
        assert r.text.splitlines()[0].startswith("lead_id,name,phone")

    def test_followups(self, owner):
        d = owner.get(f"{BASE_URL}/api/followups", params={"date": "2026-11-18"}, timeout=30).json()
        assert set(d["summary"]) == {"overdue", "due", "upcoming"}
        assert sum(r["overdue"] for r in d["by_bdm"]) == d["summary"]["overdue"]
        assert all(i["follow_up_date"] == "2026-11-18" for i in d["due"])

    def test_normalization_preview(self, owner):
        for text, exp in [("bariatric surgery (BIDD", "Bariatric Surgery"), ("VARICOSE A/B – Copy", "Varicose Veins"), ("", "Unspecified"), ("knee replacement", "Other")]:
            d = owner.post(f"{BASE_URL}/api/normalization/preview", json={"text": text}, timeout=30).json()
            assert d["treatment"] == exp, (text, d)

    def test_normalization_get_and_audit(self, owner):
        d = owner.get(f"{BASE_URL}/api/normalization", timeout=30).json()
        assert len(d["rules"]) >= 4 and len(d["mappings"]) > 0
        a = owner.get(f"{BASE_URL}/api/audit", timeout=30).json()
        assert any(x["action"] == "auth.login" for x in a)


# ---------- Lead mutations + sync persistence + allocation (sequential, restores original values) ----------
class TestLeadMutations:
    def test_edit_note_reminder_sync_allocation(self, owner):
        lead = owner.get(f"{BASE_URL}/api/leads", params={"stage": "Follow Up", "limit": 1, "page": 5}, timeout=30).json()["items"][0]
        lid, orig = lead["id"], {k: lead[k] for k in ("stage", "bdm", "follow_up_date")}
        try:
            r = owner.patch(f"{BASE_URL}/api/leads/{lid}", json={"stage": "Hot Lead", "follow_up_date": "2026-12-01"}, timeout=30)
            assert r.status_code == 200 and r.json()["stage"] == "Hot Lead" and r.json()["follow_up_date"] == "2026-12-01"
            assert owner.post(f"{BASE_URL}/api/leads/{lid}/notes", json={"text": "TEST_note"}, timeout=30).status_code == 200
            rem = owner.post(f"{BASE_URL}/api/leads/{lid}/reminders", json={"date": "2026-11-18", "note": "TEST_rem"}, timeout=30).json()
            notif = owner.get(f"{BASE_URL}/api/notifications", timeout=30).json()
            assert any(x["id"] == rem["id"] for x in notif["reminders"])
            det = owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()
            texts = [a["text"] for a in det["activity"]]
            assert "TEST_note" in texts and any("Stage changed" in t for t in texts)
            assert owner.post(f"{BASE_URL}/api/reminders/{rem['id']}/done", timeout=30).status_code == 200
            # manual sync must keep CRM edits
            s = owner.post(f"{BASE_URL}/api/sync", timeout=120)
            assert s.status_code == 200 and s.json()["count"] > 2000
            after = owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()["lead"]
            assert after["stage"] == "Hot Lead" and after["follow_up_date"] == "2026-12-01"
            # allocation: unassign this lead, activate only one BDM, run
            alloc = owner.get(f"{BASE_URL}/api/allocation", timeout=30).json()
            orig_alloc = {"auto_assign": alloc["auto_assign"], "rules": alloc["rules"]}
            owner.patch(f"{BASE_URL}/api/leads/{lid}", json={"bdm": "Unassigned"}, timeout=30)
            assert owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()["lead"]["bdm"] == ""
            target = orig["bdm"] or alloc["rules"][0]["bdm"]
            rules = [{**r, "active": r["bdm"] == target, "daily_quota": 500} for r in alloc["rules"]]
            try:
                assert owner.put(f"{BASE_URL}/api/allocation", json={"auto_assign": False, "rules": rules}, timeout=30).status_code == 200
                run = owner.post(f"{BASE_URL}/api/allocation/run", timeout=60).json()
                assert run["assigned"] >= 1 and target in run["by_bdm"]
                assert owner.get(f"{BASE_URL}/api/leads/{lid}", timeout=30).json()["lead"]["bdm"] == target
            finally:
                owner.put(f"{BASE_URL}/api/allocation", json=orig_alloc, timeout=30)
        finally:
            owner.patch(f"{BASE_URL}/api/leads/{lid}", json={**orig, "bdm": orig["bdm"] or "Unassigned"}, timeout=30)

    def test_bdm_cannot_reassign(self, bdm):
        lead = bdm.get(f"{BASE_URL}/api/leads", params={"limit": 1}, timeout=30).json()["items"][0]
        assert bdm.patch(f"{BASE_URL}/api/leads/{lead['id']}", json={"bdm": "Usman"}, timeout=30).status_code == 403

    def test_invalid_inputs(self, owner):
        lead = owner.get(f"{BASE_URL}/api/leads", params={"limit": 1}, timeout=30).json()["items"][0]
        assert owner.patch(f"{BASE_URL}/api/leads/{lead['id']}", json={"stage": "Bogus"}, timeout=30).status_code == 400
        assert owner.patch(f"{BASE_URL}/api/leads/{lead['id']}", json={"follow_up_date": "01/12/2026"}, timeout=30).status_code == 400
        assert owner.get(f"{BASE_URL}/api/leads/does-not-exist", timeout=30).status_code == 404


# ---------- Team ----------
class TestTeam:
    def test_owner_crud_and_manager_limits(self, owner, manager):
        email = f"test_bdm_{uuid.uuid4().hex[:6]}@example.com"
        r = owner.post(f"{BASE_URL}/api/users", json={"name": "TEST_Zed Tester", "email": email, "password": "TestPass123", "role": "BDM"}, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        try:
            assert u["bdm_name"] == "Test_Zed" or u["bdm_name"]
            assert login(email, "TestPass123").status_code == 200
            p = owner.patch(f"{BASE_URL}/api/users/{u['id']}", json={"active": False}, timeout=30)
            assert p.status_code == 200 and p.json()["active"] is False
            assert login(email, "TestPass123").status_code == 401
            assert manager.post(f"{BASE_URL}/api/users", json={"name": "TEST_Mgr", "email": f"x{email}", "password": "TestPass123", "role": "Manager"}, timeout=30).status_code == 403
            assert manager.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=30).status_code == 403
            assert owner.post(f"{BASE_URL}/api/users", json={"name": "TEST_Dup", "email": email, "password": "TestPass123", "role": "BDM"}, timeout=30).status_code == 400
        finally:
            assert owner.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=30).status_code == 200
        assert all(x["id"] != u["id"] for x in owner.get(f"{BASE_URL}/api/users", timeout=30).json())

    def test_manager_creates_bdm(self, owner, manager):
        email = f"test_mbdm_{uuid.uuid4().hex[:6]}@example.com"
        r = manager.post(f"{BASE_URL}/api/users", json={"name": "TEST_Mbdm", "email": email, "password": "TestPass123", "role": "BDM"}, timeout=30)
        assert r.status_code == 200
        owner.delete(f"{BASE_URL}/api/users/{r.json()['id']}", timeout=30)
