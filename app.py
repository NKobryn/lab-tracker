"""Точка входу для Vercel: він шукає змінну app у файлі app.py в корені проєкту."""
import sys
from pathlib import Path

# backend/main.py імпортує db.py як сусідній модуль, тому додаємо папку backend у шлях пошуку
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from main import app  # noqa: E402
