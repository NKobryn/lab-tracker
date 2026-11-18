"""Підключення до MongoDB: база lab_tracker, колекції subjects і labs."""
import os

from pymongo import ASCENDING, MongoClient

# Адресу сервера і назву бази можна змінити змінними середовища (за замовчуванням — локальний MongoDB)
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "lab_tracker")

client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=10000)
db = client[DB_NAME]
subjects = db["subjects"]  # предмети
labs = db["labs"]          # лабораторні (кожна посилається на предмет через subject_id)


def setup():
    """Створює індекси (якщо вони вже є, MongoDB нічого не змінює)."""
    # в одному предметі не може бути двох лаб з однаковим номером
    labs.create_index([("subject_id", ASCENDING), ("number", ASCENDING)], unique=True)
    # для фільтрів за статусом і за «цим тижнем»
    labs.create_index("status")
    labs.create_index("this_week")