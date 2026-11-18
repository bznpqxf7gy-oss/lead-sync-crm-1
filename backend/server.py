from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import asyncio  # noqa: E402
import hmac  # noqa: E402
import csv  # noqa: E402
import io  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import uuid  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from typing import List, Optional  # noqa: E402

import bcrypt  # noqa: E402
import jwt  # noqa: E402
import requests  # noqa: E402
from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from pydantic import BaseModel, EmailStr, Field  # noqa: E402
from pymongo import ASCENDING, DESCENDING, UpdateOne  # noqa: E402

from normalize import DEFAULT_TREATMENT_RULES, OTHER, STAGES, TERMINAL_STAGES, UNSPECIFIED, normalize_row, normalize_treatment  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("surgiassist")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
CRON_SECRET = os.environ["WEBHOOK_CRON_SECRET"]
SHEET_CSV_URL = os.environ["SHEET_CSV_URL"]
SYNC_INTERVAL = 300
IST = timezone(timedelta(hours=5, minutes=30))
ROLES = ["Master Owner", "Manager", "BDM"]
ADMINS = ("Master Owner", "Manager")
SYNC_STATE = {"next_sync_at": None}
sync_lock = asyncio.Lock()
FIELD_LABELS = {"stage": "Stage", "sub_status": "Status", "bdm": "BDM", "follow_up_date": "Follow-up date"}
LIST_FIELDS = {"_id": 0, "raw": 0, "comments": 0}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ist_today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def uid() -> str:
    return str(uuid.uuid4())


def hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_pw(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def public_user(user: dict) -> dict:
    return {k: user.get(k) for k in ["id", "name", "email", "role", "bdm_name", "phone", "active", "created_at"]}


def valid_date(value: str, field: str = "date") -> str:
    if value:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"{field} must be a valid YYYY-MM-DD date") from exc
    return value


# ---------- models ----------
class LoginInput(BaseModel):
    email: EmailStr
    password: str


class UserCreate(BaseModel):
    name: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=8)
    role: str
    bdm_name: str = ""
    phone: str = ""


class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    bdm_name: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class AttendanceInput(BaseModel):
    date: str
    off: List[str] = []


class LeadUpdate(BaseModel):
    stage: Optional[str] = None
    bdm: Optional[str] = None
    follow_up_date: Optional[str] = None


class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class FollowupDone(BaseModel):
    next_date: str = ""
    note: str = ""


class ReminderInput(BaseModel):
    date: str
    note: str = Field(default="", max_length=500)


class AllocationRule(BaseModel):
    bdm: str
    active: bool = True
    daily_quota: int = Field(default=15, ge=0, le=500)
    priorities: List[str] = []


class AllocationInput(BaseModel):
    auto_assign: bool = False
    rules: List[AllocationRule]


class TreatmentRule(BaseModel):
    category: str = Field(min_length=2)
    keywords: List[str]


class NormalizationInput(BaseModel):
    rules: List[TreatmentRule]


class PreviewInput(BaseModel):
    text: str


# ---------- auth ----------
def make_token(user: dict) -> str:
    payload = {"sub": user["id"], "role": user["role"], "type": "access", "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please sign in")
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Account not available")
    return user


def require(*roles):
    async def checker(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You don't have access to this area")
        return user
    return checker


def scope(user: dict) -> dict:
    query = {"is_test": False}
    if user["role"] == "BDM":
        query["bdm"] = user.get("bdm_name") or "__none__"
    return query


async def audit(user: dict, action: str, target: str = "", details: Optional[dict] = None):
    await db.audit.insert_one({"id": uid(), "user_id": user.get("id", ""), "user_name": user.get("name", "System"), "role": user.get("role", "System"), "action": action, "target": target, "details": details or {}, "created_at": now_iso()})


async def log_activity(lead_id: str, kind: str, text: str, user: dict):
    await db.activity.insert_one({"id": uid(), "lead_id": lead_id, "type": kind, "text": text, "user_name": user.get("name", "System"), "created_at": now_iso()})


SYSTEM = {"id": "system", "name": "Auto-allocation", "role": "System"}


# ---------- sync ----------
async def get_treatment_rules() -> list:
    doc = await db.settings.find_one({"id": "treatment_rules"}, {"_id": 0})
    return doc["rules"] if doc else DEFAULT_TREATMENT_RULES


def sheet_rows(text: str) -> list:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    headers = [re.sub(r"\s+", " ", h).strip().lower() for h in rows[0]]
    if "follow up date" not in headers and "status" in headers:
        idx = headers.index("status") + 1
        if idx < len(headers) and not headers[idx]:
            headers[idx] = "follow up date"
    return [{h or f"col{i}": (row[i] if i < len(row) else "") for i, h in enumerate(headers)} for row in rows[1:]]


async def run_sync(trigger: str = "auto") -> dict:
    async with sync_lock:
        response = await asyncio.to_thread(requests.get, SHEET_CSV_URL, timeout=30)
        response.raise_for_status()
        reader = sheet_rows(response.content.decode("utf-8-sig"))
        rules = await get_treatment_rules()
        edited = {d["id"]: d.get("edited_fields", []) async for d in db.leads.find({}, {"_id": 0, "id": 1, "edited_fields": 1})}
        now, ops, ids, seen = now_iso(), [], [], {}
        for index, raw in enumerate(reader):
            lead = normalize_row(raw, rules)
            if lead is None:
                continue
            base = lead["id"]
            seen[base] = seen.get(base, 0) + 1
            if seen[base] > 1:
                lead["id"] = f"{base}-{seen[base] - 1}"
            lead.update({"row_number": index + 2, "synced_at": now})
            for field in edited.get(lead["id"], []):
                lead.pop(field, None)
            ops.append(UpdateOne({"id": lead["id"]}, {"$set": lead, "$setOnInsert": {"edited_fields": [], "first_seen_at": now}}, upsert=True))
            ids.append(lead["id"])
        if ops:
            await db.leads.bulk_write(ops, ordered=False)
            await db.leads.delete_many({"id": {"$nin": ids}})
        meta = {"id": "master", "last_synced_at": now, "count": len(ids), "status": "healthy", "trigger": trigger, "error": ""}
        await db.sync_meta.replace_one({"id": "master"}, meta, upsert=True)
    settings = await db.settings.find_one({"id": "allocation"}, {"_id": 0}) or {}
    if settings.get("auto_assign"):
        await run_allocation(SYSTEM)
    meta.pop("_id", None)
    return meta


def schedule_next_sync():
    SYNC_STATE["next_sync_at"] = (datetime.now(timezone.utc) + timedelta(seconds=SYNC_INTERVAL)).isoformat()


async def sync_loop():
    while True:
        try:
            await run_sync("auto")
        except Exception as exc:  # keep the loop alive on network/sheet errors
            logger.warning("Sheet sync failed: %s", exc)
            await db.sync_meta.update_one({"id": "master"}, {"$set": {"status": "error", "error": str(exc)}}, upsert=True)
        schedule_next_sync()
        while datetime.now(timezone.utc).isoformat() < SYNC_STATE["next_sync_at"]:
            await asyncio.sleep(1)


# ---------- allocation ----------
async def known_bdms() -> list:
    names = set(n for n in await db.leads.distinct("bdm", {"is_test": False}) if n)
    names |= set(u["bdm_name"] for u in await db.users.find({"role": "BDM"}, {"_id": 0, "bdm_name": 1}).to_list(500) if u.get("bdm_name"))
    return sorted(names)


async def load_allocation() -> dict:
    doc = await db.settings.find_one({"id": "allocation"}, {"_id": 0}) or {}
    by_bdm = {r["bdm"]: r for r in doc.get("rules", [])}
    rules = [by_bdm.get(b, {"bdm": b, "active": True, "daily_quota": 15, "priorities": []}) for b in await known_bdms()]
    return {"auto_assign": doc.get("auto_assign", False), "rules": rules}


async def counts_by(match: dict, field: str) -> dict:
    rows = await db.leads.aggregate([{"$match": match}, {"$group": {"_id": f"${field}", "count": {"$sum": 1}}}]).to_list(None)
    return {r["_id"]: r["count"] for r in rows}


async def run_allocation(user: dict) -> dict:
    config, today = await load_allocation(), ist_today()
    off = set(await bdms_off(today))
    rules = [r for r in config["rules"] if r["active"] and r["daily_quota"] > 0 and r["bdm"] not in off]
    load = await counts_by({"assigned_on": today, "is_test": False}, "bdm")
    query = {"is_test": False, "bdm": "", "stage": {"$nin": TERMINAL_STAGES}, "office_date": {"$lte": today}}
    leads = await db.leads.find(query, {"_id": 0, "id": 1, "treatment": 1}).sort("created_at", ASCENDING).to_list(5000)
    assigned = {}
    for lead in leads:
        open_rules = [r for r in rules if load.get(r["bdm"], 0) < r["daily_quota"]]
        if not open_rules:
            break
        rank = lambda r: (r["priorities"].index(lead["treatment"]) if lead["treatment"] in r["priorities"] else 99, load.get(r["bdm"], 0) / r["daily_quota"])
        best = min(open_rules, key=rank)["bdm"]
        await db.leads.update_one({"id": lead["id"]}, {"$set": {"bdm": best, "assigned_on": today, "assigned_by": user["name"]}, "$addToSet": {"edited_fields": "bdm"}})
        await log_activity(lead["id"], "assign", f"Assigned to {best} by allocation rules", user)
        load[best] = load.get(best, 0) + 1
        assigned[best] = assigned.get(best, 0) + 1
    if assigned:
        await audit(user, "allocation.run", "leads", assigned)
    return {"assigned": sum(assigned.values()), "by_bdm": assigned, "remaining_unassigned": len(leads) - sum(assigned.values()), "off_today": sorted(off)}


async def bdms_off(day: str) -> list:
    doc = await db.attendance.find_one({"date": day}, {"_id": 0})
    return doc["off"] if doc else []


# ---------- whatsapp digest (not connected: messages are prepared, not sent) ----------
def wa_phone(phone: str) -> str:
    return f"+91{phone}" if len(phone) == 10 else f"+{phone}" if phone else "no phone"


async def build_whatsapp_digest(user: dict) -> dict:
    today = ist_today()
    phones = {u["bdm_name"]: u.get("phone", "") for u in await db.users.find({"role": "BDM"}, {"_id": 0}).to_list(500) if u.get("bdm_name")}
    off = set(await bdms_off(today))
    await db.whatsapp_outbox.delete_many({"date": today, "bdm": {"$in": list(off)}})
    base = {"is_test": False, "stage": {"$nin": TERMINAL_STAGES}}
    fields = {"_id": 0, "name": 1, "phone": 1, "treatment": 1, "follow_up_date": 1}
    created = 0
    for bdm in await known_bdms():
        if bdm in off:
            continue
        due = await db.leads.find({**base, "bdm": bdm, "follow_up_date": today}, fields).to_list(500)
        overdue = await db.leads.find({**base, "bdm": bdm, "follow_up_date": {"$ne": "", "$lt": today}}, fields).sort("follow_up_date", DESCENDING).to_list(500)
        new = await db.leads.count_documents({"is_test": False, "bdm": bdm, "office_date": today})
        lines = [f"Good morning {bdm}! Surgiassist plan for {today}:", f"New leads today: {new}", f"Due today: {len(due)}", f"Overdue: {len(overdue)}"]
        lines += [f"- {l['name']} ({l['treatment']}) {wa_phone(l['phone'])}" for l in due[:10]]
        lines += [f"- OVERDUE {l['follow_up_date']}: {l['name']} ({l['treatment']}) {wa_phone(l['phone'])}" for l in overdue[:10]]
        doc = {"id": uid(), "date": today, "bdm": bdm, "to": wa_phone(phones[bdm]) if phones.get(bdm) else "", "message": "\n".join(lines), "due": len(due), "overdue": len(overdue), "new_leads": new,
               "status": "not_sent", "reason": "WhatsApp not connected yet", "created_at": now_iso()}
        await db.whatsapp_outbox.replace_one({"date": today, "bdm": bdm}, doc, upsert=True)
        created += 1
    await audit(user, "whatsapp.digest", today, {"messages": created})
    return {"date": today, "messages": created, "sent": 0}


# ---------- startup ----------
async def ensure_indexes():
    specs = [("leads", [("id", ASCENDING)], True), ("leads", [("created_date", DESCENDING)], False), ("leads", [("follow_up_date", ASCENDING)], False), ("leads", [("office_date", DESCENDING)], False), ("attendance", [("date", ASCENDING)], True), ("cron_runs", [("run_id", ASCENDING)], True),
             ("leads", [("bdm", ASCENDING)], False), ("leads", [("stage", ASCENDING)], False), ("users", [("email", ASCENDING)], True),
             ("users", [("id", ASCENDING)], True), ("activity", [("lead_id", ASCENDING), ("created_at", DESCENDING)], False),
             ("audit", [("created_at", DESCENDING)], False), ("login_attempts", [("identifier", ASCENDING)], False), ("reminders", [("user_id", ASCENDING), ("date", ASCENDING)], False)]
    for collection, keys, unique in specs:
        try:
            await db[collection].create_index(keys, unique=unique)
        except Exception as exc:
            logger.warning("Index on %s failed: %s", collection, exc)


async def seed_users():
    seeds = [("Surgiassist Owner", os.environ["ADMIN_EMAIL"], os.environ["ADMIN_PASSWORD"], "Master Owner", ""),
             ("Operations Manager", "manager@surgiassist.com", os.environ["DEMO_USER_PASSWORD"], "Manager", ""),
             ("Muskaan", "muskaan@surgiassist.com", os.environ["DEMO_USER_PASSWORD"], "BDM", "Muskaan")]
    for name, email, password, role, bdm in seeds:
        if not await db.users.find_one({"email": email.lower()}):
            await db.users.insert_one({"id": uid(), "name": name, "email": email.lower(), "role": role, "bdm_name": bdm, "active": True, "password_hash": hash_pw(password), "created_at": now_iso()})


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_indexes()
    await seed_users()
    task = asyncio.create_task(sync_loop())
    yield
    task.cancel()
    client.close()


app = FastAPI(title="Surgiassist CRM API", lifespan=lifespan)
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "Surgiassist CRM API online"}


# ---------- auth routes ----------
@api.post("/auth/login")
async def login(payload: LoginInput):
    email = payload.email.lower()
    attempt = await db.login_attempts.find_one({"identifier": email}, {"_id": 0}) or {}
    if attempt.get("locked_until", "") > now_iso():
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in 15 minutes.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not check_pw(payload.password, user["password_hash"]) or not user.get("active", True):
        count = attempt.get("count", 0) + 1
        update = {"count": 0, "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()} if count >= 5 else {"count": count}
        await db.login_attempts.update_one({"identifier": email}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    await db.login_attempts.delete_many({"identifier": email})
    await audit(user, "auth.login", email)
    return {"token": make_token(user), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


@api.post("/auth/change-password")
async def change_password(payload: PasswordChange, user: dict = Depends(current_user)):
    record = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1})
    if not check_pw(payload.current_password, record["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(payload.new_password)}})
    await audit(user, "auth.password_change", user["email"])
    return {"ok": True}


# ---------- attendance ----------
@api.get("/attendance")
async def get_attendance(date: str = "", user: dict = Depends(require(*ADMINS))):
    day = valid_date(date) or ist_today()
    off = set(await bdms_off(day))
    return {"date": day, "bdms": [{"bdm": b, "present": b not in off} for b in await known_bdms()]}


@api.put("/attendance")
async def save_attendance(payload: AttendanceInput, user: dict = Depends(require(*ADMINS))):
    if not payload.date:
        raise HTTPException(status_code=400, detail="Pick a date")
    valid_date(payload.date)
    await db.attendance.replace_one({"date": payload.date}, {"date": payload.date, "off": sorted(set(payload.off)), "updated_by": user["name"], "updated_at": now_iso()}, upsert=True)
    await audit(user, "attendance.save", payload.date, {"off": payload.off})
    return {"ok": True}


# ---------- reports ----------
@api.get("/reports/campaigns")
async def campaign_report(user: dict = Depends(require(*ADMINS))):
    def stage_sum(stages):
        return {"$sum": {"$cond": [{"$in": ["$stage", stages]}, 1, 0]}}
    rows = await db.leads.aggregate([{"$match": {"is_test": False}}, {"$group": {"_id": {"t": "$treatment", "v": "$treatment_variant"}, "total": {"$sum": 1},
        "hot": stage_sum(["Hot Lead", "OPD Booked"]), "opd": stage_sum(["OPD Done", "Surgery Done"]), "surgeries": stage_sum(["Surgery Done"]), "lost": stage_sum(["Lost"])}},
        {"$sort": {"surgeries": -1, "total": -1}}]).to_list(None)
    return [{"treatment": r["_id"]["t"], "variant": r["_id"]["v"] or "—", "total": r["total"], "hot": r["hot"], "opd": r["opd"], "surgeries": r["surgeries"], "lost": r["lost"],
             "conversion": round(r["surgeries"] / r["total"] * 100, 2) if r["total"] else 0} for r in rows]


# ---------- whatsapp ----------
@api.get("/whatsapp/outbox")
async def whatsapp_outbox(date: str = "", user: dict = Depends(require(*ADMINS))):
    day = valid_date(date) or ist_today()
    return {"date": day, "connected": False, "items": await db.whatsapp_outbox.find({"date": day}, {"_id": 0}).sort("bdm", ASCENDING).to_list(500)}


@api.post("/whatsapp/digest/run")
async def whatsapp_run(user: dict = Depends(require(*ADMINS))):
    return await build_whatsapp_digest(user)


# ---------- scheduled jobs (platform cron) ----------
async def cron_accept(request: Request, job: str) -> bool:
    token = request.headers.get("Authorization", "")
    if not token.startswith("Bearer ") or not hmac.compare_digest(token[7:], CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        body = await request.json() if await request.body() else {}
    except ValueError:
        body = {}
    run_id = request.headers.get("X-Webhook-Id") or (body.get("run_id") if isinstance(body, dict) else None) or uid()
    result = await db.cron_runs.update_one({"run_id": run_id}, {"$setOnInsert": {"run_id": run_id, "job": job, "received_at": now_iso()}}, upsert=True)
    return result.upserted_id is not None


async def morning_allocation_job():
    try:
        await run_sync("scheduled")
    except Exception as exc:
        logger.warning("Pre-allocation sync failed: %s", exc)
    await run_allocation({"id": "system", "name": "9:55 auto-allocation", "role": "System"})


@api.post("/cron/morning-allocation")
async def cron_morning_allocation(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    if await cron_accept(request, "morning-allocation"):
        background.add_task(morning_allocation_job)
    return {"accepted": True}


@api.post("/cron/whatsapp-digest")
async def cron_whatsapp_digest(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    if await cron_accept(request, "whatsapp-digest"):
        background.add_task(build_whatsapp_digest, {"id": "system", "name": "10:00 WhatsApp digest", "role": "System"})
    return {"accepted": True}


# ---------- meta / sync ----------
@api.get("/meta")
async def meta(user: dict = Depends(current_user)):
    rules = await get_treatment_rules()
    return {"stages": STAGES, "terminal_stages": TERMINAL_STAGES, "treatments": [r["category"] for r in rules] + [OTHER, UNSPECIFIED], "bdms": await known_bdms(), "roles": ROLES, "today": ist_today()}


@api.get("/sync/status")
async def sync_status(user: dict = Depends(current_user)):
    meta_doc = await db.sync_meta.find_one({"id": "master"}, {"_id": 0}) or {"status": "pending"}
    return {**meta_doc, "next_sync_at": SYNC_STATE["next_sync_at"], "interval_seconds": SYNC_INTERVAL, "running": sync_lock.locked()}


@api.post("/sync")
async def manual_sync(user: dict = Depends(require(*ADMINS))):
    try:
        result = await run_sync("manual")
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach the Google Sheet") from exc
    schedule_next_sync()
    await audit(user, "sync.manual", "google-sheet", {"count": result["count"]})
    return result


# ---------- overview ----------
PERIODS = ("today", "date", "week", "month", "year", "all")


def period_range(period: str, date: str) -> tuple:
    today = datetime.strptime(ist_today(), "%Y-%m-%d")
    if period == "date":
        if not date:
            raise HTTPException(status_code=400, detail="Pick a date")
        day = datetime.strptime(valid_date(date), "%Y-%m-%d")
        return day, day
    if period == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if period == "month":
        start = today.replace(day=1)
        return start, (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    if period == "year":
        return today.replace(month=1, day=1), today.replace(month=12, day=31)
    return today, today


@api.get("/overview")
async def overview(period: str = "today", date: str = "", user: dict = Depends(current_user)):
    if period not in PERIODS:
        raise HTTPException(status_code=400, detail="Unknown period")
    base, today = scope(user), ist_today()
    fmt = lambda d: d.strftime("%Y-%m-%d")
    if period == "all":
        start = end = ""
        q = dict(base)
    else:
        s_dt, e_dt = period_range(period, date)
        start, end = fmt(s_dt), fmt(e_dt)
        q = {**base, "office_date": {"$gte": start, "$lte": end}}
    if period in ("today", "date"):
        trend_match, key, limit = {**base, "office_date": {"$ne": "", "$lte": end}}, "$office_date", 14
    elif period in ("week", "month"):
        trend_match, key, limit = q, "$office_date", 31
    else:
        trend_match, key, limit = {**q, "office_date": {**q.get("office_date", {}), "$ne": ""}}, {"$substrBytes": ["$office_date", 0, 7]}, 24
    trend = await db.leads.aggregate([{"$match": trend_match}, {"$group": {"_id": key, "count": {"$sum": 1}}}, {"$sort": {"_id": -1}}, {"$limit": limit}]).to_list(None)
    per_bdm = await counts_by(q, "bdm")
    stages, treatments = await counts_by(q, "stage"), await counts_by(q, "treatment")
    open_fu = {**base, "stage": {"$nin": TERMINAL_STAGES}}
    leaderboard = []
    if user["role"] != "BDM":
        rows = await db.leads.aggregate([{"$match": q}, {"$group": {"_id": "$bdm", "total": {"$sum": 1}, "won": {"$sum": {"$cond": [{"$eq": ["$stage", "Surgery Done"]}, 1, 0]}}, "hot": {"$sum": {"$cond": [{"$in": ["$stage", ["Hot Lead", "OPD Booked", "OPD Done"]]}, 1, 0]}}, "lost": {"$sum": {"$cond": [{"$eq": ["$stage", "Lost"]}, 1, 0]}}}}, {"$sort": {"total": -1}}]).to_list(None)
        leaderboard = [{"bdm": r["_id"] or "Unassigned", "total": r["total"], "won": r["won"], "hot": r["hot"], "lost": r["lost"]} for r in rows]
    arrived = sum(per_bdm.values())
    return {
        "period": period, "start": start, "end": end, "date": end or today, "today": today, "trend_unit": "month" if period in ("year", "all") else "day",
        "total_leads": arrived, "all_time_leads": await db.leads.count_documents(base), "leads_on_date": arrived,
        "day": {"arrived": arrived, "after_hours": await db.leads.count_documents({**q, "after_hours": True}), "unassigned": per_bdm.get("", 0),
                "assigned": sum(v for k, v in per_bdm.items() if k), "by_bdm": sorted([{"bdm": k, "count": v} for k, v in per_bdm.items() if k], key=lambda x: -x["count"]),
                "off": await bdms_off(end) if start == end and end else []},
        "hot_pipeline": sum(stages.get(s, 0) for s in ["Hot Lead", "OPD Booked", "OPD Done"]), "surgeries_done": stages.get("Surgery Done", 0),
        "overdue": await db.leads.count_documents({**open_fu, "follow_up_date": {"$ne": "", "$lt": today}}),
        "due_today": await db.leads.count_documents({**open_fu, "follow_up_date": today}),
        "by_stage": [{"name": s, "count": stages.get(s, 0)} for s in STAGES],
        "by_treatment": sorted([{"name": k, "count": v} for k, v in treatments.items()], key=lambda x: -x["count"]),
        "trend": [{"date": t["_id"], "count": t["count"]} for t in reversed(trend)], "leaderboard": leaderboard,
    }


# ---------- leads ----------
def lead_query(user: dict, search: str, date: str, treatment: str, stage: str, bdm: str) -> dict:
    query = scope(user)
    if search.strip():
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"name": rx}, {"phone": rx}, {"city": rx}, {"lead_id": rx}]
    if valid_date(date):
        query["office_date"] = date
    if treatment:
        query["treatment"] = treatment
    if stage:
        query["stage"] = stage
    if bdm and user["role"] != "BDM":
        query["bdm"] = "" if bdm == "Unassigned" else bdm
    return query


@api.get("/leads")
async def list_leads(search: str = "", date: str = "", treatment: str = "", stage: str = "", bdm: str = "", page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=200), user: dict = Depends(current_user)):
    query = lead_query(user, search, date, treatment, stage, bdm)
    total = await db.leads.count_documents(query)
    items = await db.leads.find(query, LIST_FIELDS).sort([("created_at", DESCENDING), ("row_number", DESCENDING)]).skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"items": items, "total": total, "page": page, "limit": limit}


@api.get("/leads/export")
async def export_leads(search: str = "", date: str = "", treatment: str = "", stage: str = "", bdm: str = "", user: dict = Depends(current_user)):
    query = lead_query(user, search, date, treatment, stage, bdm)
    cols = ["lead_id", "name", "phone", "city", "treatment", "treatment_variant", "raw_treatment", "stage", "sub_status", "bdm", "follow_up_date", "created_at", "insurance_status", "comments"]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(cols)
    count = 0
    async for lead in db.leads.find(query, {"_id": 0}).sort("created_at", DESCENDING):
        writer.writerow([lead.get(c, "") for c in cols])
        count += 1
    await audit(user, "leads.export", "leads", {"rows": count})
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=surgiassist-leads-{ist_today()}.csv"})


async def scoped_lead(lead_id: str, user: dict) -> dict:
    lead = await db.leads.find_one({"id": lead_id, **scope(user)}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@api.get("/leads/{lead_id}")
async def lead_detail(lead_id: str, user: dict = Depends(current_user)):
    lead = await scoped_lead(lead_id, user)
    activity = await db.activity.find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", DESCENDING).to_list(200)
    reminders = await db.reminders.find({"lead_id": lead_id, "user_id": user["id"], "done": False}, {"_id": 0}).sort("date", ASCENDING).to_list(50)
    return {"lead": lead, "activity": activity, "reminders": reminders}


@api.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, payload: LeadUpdate, user: dict = Depends(current_user)):
    lead = await scoped_lead(lead_id, user)
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "stage" in changes:
        if changes["stage"] not in STAGES:
            raise HTTPException(status_code=400, detail="Unknown stage")
        if changes["stage"] != lead.get("stage"):
            changes["sub_status"] = changes["stage"].upper()
    if "bdm" in changes:
        if user["role"] == "BDM":
            raise HTTPException(status_code=403, detail="BDMs cannot reassign leads")
        changes["bdm"] = "" if changes["bdm"] == "Unassigned" else changes["bdm"]
        if changes["bdm"] and changes["bdm"] != lead.get("bdm"):
            changes["assigned_on"] = ist_today()
    if "follow_up_date" in changes:
        valid_date(changes["follow_up_date"], "Follow-up date")
    diffs = {k: v for k, v in changes.items() if lead.get(k) != v}
    if diffs:
        await db.leads.update_one({"id": lead_id}, {"$set": diffs, "$addToSet": {"edited_fields": {"$each": [k for k in diffs if k in FIELD_LABELS]}}})
        for key, value in diffs.items():
            if key in FIELD_LABELS and key != "sub_status":
                await log_activity(lead_id, "update", f"{FIELD_LABELS[key]} changed from {lead.get(key) or '—'} to {value or '—'}", user)
        await audit(user, "lead.update", lead_id, {k: v for k, v in diffs.items() if k in FIELD_LABELS})
    return await scoped_lead(lead_id, user)


@api.post("/leads/{lead_id}/notes")
async def add_note(lead_id: str, payload: NoteInput, user: dict = Depends(current_user)):
    await scoped_lead(lead_id, user)
    await log_activity(lead_id, "note", payload.text.strip(), user)
    await audit(user, "lead.note", lead_id)
    return {"ok": True}


@api.post("/leads/{lead_id}/followup/complete")
async def complete_followup(lead_id: str, payload: FollowupDone, user: dict = Depends(current_user)):
    lead = await scoped_lead(lead_id, user)
    valid_date(payload.next_date, "Next date")
    await db.leads.update_one({"id": lead_id}, {"$set": {"follow_up_date": payload.next_date}, "$addToSet": {"edited_fields": "follow_up_date"}})
    text = f"Follow-up of {lead.get('follow_up_date') or '—'} completed" + (f", next on {payload.next_date}" if payload.next_date else "") + (f". {payload.note}" if payload.note else "")
    await log_activity(lead_id, "followup", text, user)
    await audit(user, "followup.complete", lead_id, {"next_date": payload.next_date})
    return {"ok": True}


@api.post("/leads/{lead_id}/reminders")
async def add_reminder(lead_id: str, payload: ReminderInput, user: dict = Depends(current_user)):
    lead = await scoped_lead(lead_id, user)
    if not payload.date:
        raise HTTPException(status_code=400, detail="Pick a reminder date")
    valid_date(payload.date, "Reminder date")
    doc = {"id": uid(), "lead_id": lead_id, "lead_name": lead["name"], "user_id": user["id"], "date": payload.date, "note": payload.note, "done": False, "created_at": now_iso()}
    await db.reminders.insert_one(doc)
    await log_activity(lead_id, "reminder", f"Reminder set for {payload.date}" + (f": {payload.note}" if payload.note else ""), user)
    doc.pop("_id", None)
    return doc


# ---------- follow-ups / reminders ----------
@api.get("/followups")
async def followups(date: str = "", bdm: str = "", user: dict = Depends(current_user)):
    ref = valid_date(date) or ist_today()
    query = {**scope(user), "follow_up_date": {"$ne": ""}, "stage": {"$nin": TERMINAL_STAGES}}
    if bdm and user["role"] != "BDM":
        query["bdm"] = "" if bdm == "Unassigned" else bdm
    fields = {"_id": 0, "id": 1, "name": 1, "phone": 1, "city": 1, "treatment": 1, "bdm": 1, "stage": 1, "sub_status": 1, "follow_up_date": 1}
    items = await db.leads.find(query, fields).sort("follow_up_date", ASCENDING).to_list(5000)
    buckets, per_bdm = {"overdue": [], "due": [], "upcoming": []}, {}
    for item in items:
        key = "overdue" if item["follow_up_date"] < ref else "due" if item["follow_up_date"] == ref else "upcoming"
        buckets[key].append(item)
        row = per_bdm.setdefault(item["bdm"] or "Unassigned", {"bdm": item["bdm"] or "Unassigned", "overdue": 0, "due": 0, "upcoming": 0})
        row[key] += 1
    return {"date": ref, "summary": {k: len(v) for k, v in buckets.items()}, "by_bdm": sorted(per_bdm.values(), key=lambda r: (-r["overdue"], -r["due"])),
            "overdue": buckets["overdue"][-300:][::-1], "due": buckets["due"][:300], "upcoming": buckets["upcoming"][:300]}


@api.get("/notifications")
async def notifications(user: dict = Depends(current_user)):
    today, base = ist_today(), {**scope(user), "stage": {"$nin": TERMINAL_STAGES}}
    reminders = await db.reminders.find({"user_id": user["id"], "done": False, "date": {"$lte": today}}, {"_id": 0}).sort("date", ASCENDING).to_list(50)
    return {"today": today, "overdue": await db.leads.count_documents({**base, "follow_up_date": {"$ne": "", "$lt": today}}),
            "due_today": await db.leads.count_documents({**base, "follow_up_date": today}), "reminders": reminders}


@api.post("/reminders/{reminder_id}/done")
async def reminder_done(reminder_id: str, user: dict = Depends(current_user)):
    result = await db.reminders.update_one({"id": reminder_id, "user_id": user["id"]}, {"$set": {"done": True}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return {"ok": True}


# ---------- allocation ----------
@api.get("/allocation")
async def get_allocation(user: dict = Depends(require(*ADMINS))):
    config, today = await load_allocation(), ist_today()
    return {**config, "today": today, "treatments": [r["category"] for r in await get_treatment_rules()] + [OTHER, UNSPECIFIED],
            "assigned_today": await counts_by({"assigned_on": today, "is_test": False}, "bdm"),
            "open_load": await counts_by({"is_test": False, "stage": {"$nin": TERMINAL_STAGES}}, "bdm"),
            "unassigned": await db.leads.count_documents({"is_test": False, "bdm": "", "stage": {"$nin": TERMINAL_STAGES}})}


@api.put("/allocation")
async def save_allocation(payload: AllocationInput, user: dict = Depends(require(*ADMINS))):
    doc = {"id": "allocation", "auto_assign": payload.auto_assign, "rules": [r.model_dump() for r in payload.rules], "updated_at": now_iso()}
    await db.settings.replace_one({"id": "allocation"}, doc, upsert=True)
    await audit(user, "allocation.save", "rules", {"auto_assign": payload.auto_assign, "rules": len(payload.rules)})
    return {"ok": True}


@api.post("/allocation/run")
async def allocation_run(user: dict = Depends(require(*ADMINS))):
    return await run_allocation(user)


# ---------- normalization ----------
@api.get("/normalization")
async def get_normalization(user: dict = Depends(require(*ADMINS))):
    rows = await db.leads.aggregate([{"$match": {"is_test": False}}, {"$group": {"_id": "$raw_treatment", "treatment": {"$first": "$treatment"}, "variant": {"$first": "$treatment_variant"}, "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]).to_list(None)
    return {"rules": await get_treatment_rules(), "mappings": [{"raw": r["_id"] or "(blank)", "treatment": r["treatment"], "variant": r["variant"], "count": r["count"]} for r in rows]}


@api.post("/normalization/preview")
async def preview_normalization(payload: PreviewInput, user: dict = Depends(current_user)):
    category, variant = normalize_treatment(payload.text, await get_treatment_rules())
    return {"treatment": category, "variant": variant}


@api.put("/normalization")
async def save_normalization(payload: NormalizationInput, user: dict = Depends(require(*ADMINS))):
    rules = [{"category": r.category.strip(), "keywords": [k.strip().lower() for k in r.keywords if k.strip()]} for r in payload.rules]
    await db.settings.replace_one({"id": "treatment_rules"}, {"id": "treatment_rules", "rules": rules, "updated_at": now_iso()}, upsert=True)
    updated = 0
    for raw in await db.leads.distinct("raw_treatment"):
        category, variant = normalize_treatment(raw, rules)
        result = await db.leads.update_many({"raw_treatment": raw}, {"$set": {"treatment": category, "treatment_variant": variant}})
        updated += result.modified_count
    await audit(user, "normalization.save", "treatment_rules", {"rules": len(rules), "leads_updated": updated})
    return {"ok": True, "leads_updated": updated}


# ---------- users ----------
@api.get("/users")
async def list_users(user: dict = Depends(require(*ADMINS))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", ASCENDING).to_list(500)
    return [public_user(u) for u in users]


@api.post("/users")
async def create_user(payload: UserCreate, user: dict = Depends(require(*ADMINS))):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Unknown role")
    if user["role"] == "Manager" and payload.role != "BDM":
        raise HTTPException(status_code=403, detail="Managers can only add BDMs")
    if await db.users.find_one({"email": payload.email.lower()}):
        raise HTTPException(status_code=400, detail="That email already has an account")
    bdm_name = (payload.bdm_name or payload.name.split(" ")[0]).strip().title() if payload.role == "BDM" else ""
    doc = {"id": uid(), "name": payload.name.strip(), "email": payload.email.lower(), "role": payload.role, "bdm_name": bdm_name, "phone": re.sub(r"\D", "", payload.phone), "active": True, "password_hash": hash_pw(payload.password), "created_at": now_iso()}
    await db.users.insert_one(doc)
    await audit(user, "user.create", doc["email"], {"role": payload.role})
    return public_user(doc)


@api.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, user: dict = Depends(require(*ADMINS))):
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "Manager" and (target["role"] != "BDM" or (payload.role and payload.role != "BDM")):
        raise HTTPException(status_code=403, detail="Managers can only manage BDMs")
    if target["id"] == user["id"] and (payload.active is False or (payload.role and payload.role != user["role"])):
        raise HTTPException(status_code=400, detail="You can't deactivate or change your own role")
    if payload.role and payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Unknown role")
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None and k != "password"}
    if "phone" in changes:
        changes["phone"] = re.sub(r"\D", "", changes["phone"])
    if payload.password:
        changes["password_hash"] = hash_pw(payload.password)
    if changes:
        await db.users.update_one({"id": user_id}, {"$set": changes})
        await audit(user, "user.update", target["email"], {k: v for k, v in changes.items() if k != "password_hash"})
    return public_user(await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0}))


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require("Master Owner"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.delete_one({"id": user_id})
    await audit(user, "user.delete", target["email"])
    return {"ok": True}


# ---------- audit ----------
@api.get("/audit")
async def audit_log(limit: int = Query(200, ge=1, le=1000), user: dict = Depends(require(*ADMINS))):
    return await db.audit.find({}, {"_id": 0}).sort("created_at", DESCENDING).limit(limit).to_list(limit)


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=os.environ["CORS_ORIGINS"].split(","), allow_methods=["*"], allow_headers=["*"])
