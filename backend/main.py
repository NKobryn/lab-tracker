"""Backend трекера лабораторних: REST API на FastAPI + роздача фронтенду."""
import re
from datetime import date, datetime
from pathlib import Path
from typing import Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from db import labs, setup, subjects

app = FastAPI(title="Трекер лабораторних")
setup()

# Дозволені статуси: не здано, в роботі, здано
Status = Literal["not_done", "in_progress", "done"]


# ---------- Моделі даних (що приходить у запитах) ----------

class SubjectIn(BaseModel):
    name: str = Field(min_length=1)
    teacher: str = ""


class LabIn(BaseModel):
    subject_id: str
    number: int = Field(ge=1)
    title: str = Field(min_length=1)
    status: Status = "not_done"
    deadline: Optional[date] = None
    this_week: bool = False


class LabUpdate(BaseModel):
    """Усі поля необов'язкові: змінюємо лише ті, що прийшли."""
    number: Optional[int] = Field(None, ge=1)
    title: Optional[str] = Field(None, min_length=1)
    status: Optional[Status] = None
    deadline: Optional[date] = None
    this_week: Optional[bool] = None


# ---------- Допоміжні функції ----------

def to_oid(value):
    """Рядок -> ObjectId; якщо рядок неправильний — 404."""
    try:
        return ObjectId(value)
    except InvalidId:
        raise HTTPException(404, "Не знайдено")


def to_datetime(d):
    """MongoDB зберігає дати з часом, тому date перетворюємо на datetime."""
    return datetime.combine(d, datetime.min.time()) if d else None


def lab_out(doc):
    """Документ MongoDB -> JSON для фронтенду."""
    return {
        "id": str(doc["_id"]),
        "subject_id": str(doc["subject_id"]),
        "number": doc["number"],
        "title": doc["title"],
        "status": doc["status"],
        "deadline": doc["deadline"].date().isoformat() if doc.get("deadline") else None,
        "this_week": doc.get("this_week", False),
    }


def today():
    return to_datetime(date.today())


# ---------- Предмети ----------

@app.get("/api/subjects")
def list_subjects():
    """Read: усі предмети з кількістю лаб у кожному статусі."""
    # aggregate: групуємо лаби за предметом і рахуємо статуси
    counts = {
        row["_id"]: row
        for row in labs.aggregate([
            {"$group": {
                "_id": "$subject_id",
                "total": {"$sum": 1},
                "done": {"$sum": {"$cond": [{"$eq": ["$status", "done"]}, 1, 0]}},
                "in_progress": {"$sum": {"$cond": [{"$eq": ["$status", "in_progress"]}, 1, 0]}},
            }}
        ])
    }
    result = []
    for s in subjects.find().sort("name", 1):
        c = counts.get(s["_id"], {})
        result.append({
            "id": str(s["_id"]),
            "name": s["name"],
            "teacher": s.get("teacher", ""),
            "total": c.get("total", 0),
            "done": c.get("done", 0),
            "in_progress": c.get("in_progress", 0),
        })
    return result


@app.post("/api/subjects", status_code=201)
def create_subject(data: SubjectIn):
    """Create: новий предмет."""
    result = subjects.insert_one({"name": data.name.strip(), "teacher": data.teacher.strip()})
    return {"id": str(result.inserted_id)}


@app.put("/api/subjects/{subject_id}")
def update_subject(subject_id: str, data: SubjectIn):
    """Update: змінити назву або викладача."""
    result = subjects.update_one(
        {"_id": to_oid(subject_id)},
        {"$set": {"name": data.name.strip(), "teacher": data.teacher.strip()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Предмет не знайдено")
    return {"ok": True}


@app.delete("/api/subjects/{subject_id}")
def delete_subject(subject_id: str):
    """Delete: видалити предмет разом з усіма його лабами."""
    oid = to_oid(subject_id)
    deleted_labs = labs.delete_many({"subject_id": oid}).deleted_count
    if subjects.delete_one({"_id": oid}).deleted_count == 0:
        raise HTTPException(404, "Предмет не знайдено")
    return {"deleted_labs": deleted_labs}


# ---------- Лабораторні ----------

@app.get("/api/labs")
def list_labs(subject_id: Optional[list[str]] = Query(None), status: Optional[Status] = None,
              this_week: Optional[bool] = None, q: str = "", overdue: bool = False):
    """Read + фільтрація: усі умови збираються в один запит find()."""
    query = {}
    if subject_id:
        # можна передати кілька предметів: ?subject_id=...&subject_id=...
        query["subject_id"] = {"$in": [to_oid(s) for s in subject_id]}
    if status:
        query["status"] = status
    if this_week is not None:
        query["this_week"] = this_week
    if q:
        query["title"] = {"$regex": re.escape(q), "$options": "i"}  # пошук у темі без урахування регістру
    if overdue:
        query["deadline"] = {"$lt": today()}
        query["status"] = {"$ne": "done"}
    docs = labs.find(query).sort([("deadline", 1), ("number", 1)])
    return [lab_out(d) for d in docs]


@app.post("/api/labs", status_code=201)
def create_lab(data: LabIn):
    """Create: нова лабораторна в предметі."""
    subject_oid = to_oid(data.subject_id)
    if subjects.count_documents({"_id": subject_oid}) == 0:
        raise HTTPException(404, "Предмет не знайдено")
    doc = data.model_dump()
    doc["subject_id"] = subject_oid
    doc["title"] = doc["title"].strip()
    doc["deadline"] = to_datetime(data.deadline)
    try:
        result = labs.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, f"Лабораторна №{data.number} у цьому предметі вже є")
    return {"id": str(result.inserted_id)}


@app.put("/api/labs/{lab_id}")
def update_lab(lab_id: str, data: LabUpdate):
    """Update: змінюємо лише передані поля ($set)."""
    changes = data.model_dump(exclude_unset=True)
    if "deadline" in changes:
        changes["deadline"] = to_datetime(changes["deadline"])
    if not changes:
        raise HTTPException(400, "Немає що змінювати")
    try:
        result = labs.update_one({"_id": to_oid(lab_id)}, {"$set": changes})
    except DuplicateKeyError:
        raise HTTPException(409, "Лабораторна з таким номером у цьому предметі вже є")
    if result.matched_count == 0:
        raise HTTPException(404, "Лабораторну не знайдено")
    return {"ok": True}


@app.delete("/api/labs/{lab_id}")
def delete_lab(lab_id: str):
    """Delete: видалити одну лабораторну."""
    if labs.delete_one({"_id": to_oid(lab_id)}).deleted_count == 0:
        raise HTTPException(404, "Лабораторну не знайдено")
    return {"ok": True}


# ---------- Загальний прогрес ----------

@app.get("/api/progress")
def progress():
    """Скільки лаб у кожному статусі по всіх предметах (aggregate з $group)."""
    by_status = {row["_id"]: row["count"] for row in labs.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ])}
    total = sum(by_status.values())
    done = by_status.get("done", 0)
    return {
        "total": total,
        "done": done,
        "in_progress": by_status.get("in_progress", 0),
        "not_done": by_status.get("not_done", 0),
        "percent": round(done * 100 / total) if total else 0,
        "this_week": labs.count_documents({"this_week": True, "status": {"$ne": "done"}}),
        "overdue": labs.count_documents({"deadline": {"$lt": today()}, "status": {"$ne": "done"}}),
    }


# ---------- Фронтенд ----------
# Папка frontend роздається за адресою http://localhost:8000/
FRONTEND = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")