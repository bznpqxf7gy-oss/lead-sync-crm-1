import hashlib
import re
from datetime import datetime, timedelta

OFFICE_CLOSE_HOUR = 18

DEFAULT_TREATMENT_RULES = [
    {"category": "Bariatric Surgery", "keywords": ["bariatric", "sleeve", "gastric", "weight loss", "obesity"]},
    {"category": "Liposuction", "keywords": ["liposuction", "lipo"]},
    {"category": "Varicose Veins", "keywords": ["varicose", "vein"]},
    {"category": "Hernia", "keywords": ["hernia", "herni"]},
]
UNSPECIFIED = "Unspecified"
OTHER = "Other"
STAGES = ["New", "Follow Up", "Not Reachable", "Hot Lead", "OPD Booked", "OPD Done", "Surgery Done", "Lost"]
TERMINAL_STAGES = ["Surgery Done", "Lost"]
STATUS_RULES = [
    (r"^dnp", "Not Reachable"),
    (r"follow\s*up|call\s*back|hold", "Follow Up"),
    (r"hot", "Hot Lead"),
    (r"opd\s*booked", "OPD Booked"),
    (r"opd\s*done", "OPD Done"),
    (r"surgery\s*done", "Surgery Done"),
    (r"irrelevant|not\s*int|fund|out of city|junk|duplicate|not fit|supply|language|lost", "Lost"),
]
STATUS_FIXES = {"NOT INTRESTED": "NOT INTERESTED", "LANGUAGE BARIER": "LANGUAGE BARRIER"}


def clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_stage(raw: str) -> str:
    text = clean(raw).lower()
    if not text:
        return "New"
    for pattern, stage in STATUS_RULES:
        if re.search(pattern, text):
            return stage
    return "Follow Up"


def pretty_status(raw: str) -> str:
    text = clean(raw).upper()
    return STATUS_FIXES.get(text, text) or "NEW"


def _variant(text: str, keyword: str) -> str:
    rest = re.sub(r"[–—-]?\s*copy(\s*\d+)?", " ", text).replace(keyword, " ")
    rest = re.sub(r"\b(surgery|surgeries|veins?|city)\b", " ", rest)
    rest = re.sub(r"[()\[\]]", " ", rest)
    return re.sub(r"\s+", " ", rest).strip(" -–—/").upper()


def normalize_treatment(raw: str, rules: list) -> tuple:
    text = clean(raw).lower()
    if not text:
        return UNSPECIFIED, ""
    for rule in rules:
        for keyword in rule.get("keywords", []):
            key = keyword.lower().strip()
            if key and key in text:
                return rule["category"], _variant(text, key)
    return OTHER, clean(raw).upper()


def parse_created(value: str) -> tuple:
    text = clean(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.strftime("%Y-%m-%dT%H:%M:%S"), dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return "", ""


def office_day(created_at: str) -> tuple:
    if not created_at:
        return "", False
    dt = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%S")
    after_hours = dt.hour >= OFFICE_CLOSE_HOUR
    return (dt + timedelta(days=1) if after_hours else dt).strftime("%Y-%m-%d"), after_hours


def parse_date(value: str) -> str:
    text = re.sub(r"[^0-9/\-]", "", str(value or ""))
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def normalize_row(raw: dict, rules: list):
    row = {clean(k).lower(): clean(v) for k, v in raw.items() if k is not None and not isinstance(v, list)}
    get = lambda key: row.get(key, "")
    lead_id, name = get("lead id"), get("patient name")
    if not lead_id.isdigit():
        lead_id = ""
    phone = "" if "test lead" in get("mobile no").lower() else re.sub(r"\D", "", get("mobile no"))
    if not (lead_id or name or phone):
        return None
    created_at, created_date = parse_created(get("lead creation time"))
    treatment, variant = normalize_treatment(get("treatment"), rules)
    office_date, after_hours = office_day(created_at)
    bdm_raw = get("bdm")
    is_test = "test lead" in f"{name} {bdm_raw}".lower()
    bdm = "" if (not bdm_raw or re.search(r"\d", bdm_raw) or is_test) else bdm_raw.title()
    ident = lead_id or "row-" + hashlib.md5(f"{name}|{phone}|{get('lead creation time')}".encode()).hexdigest()[:16]
    return {
        "id": ident, "lead_id": lead_id, "name": (name.title() if name.islower() else name) or "Unnamed lead",
        "phone": phone, "city": get("city").title(), "raw_treatment": get("treatment"), "treatment": treatment,
        "treatment_variant": variant, "qualified": get("qualified").lower() == "qualified", "bdm": bdm,
        "insurance_status": get("insurance status").title(), "insurance_received": get("insurance recived").upper(),
        "raw_status": get("status"), "sub_status": pretty_status(get("status")), "stage": normalize_stage(get("status")),
        "follow_up_date": parse_date(get("follow up date")), "month": get("month"), "comments": get("comments"),
        "created_at": created_at, "created_date": created_date, "office_date": office_date, "after_hours": after_hours, "is_test": is_test, "source": "Google Sheets",
    }
