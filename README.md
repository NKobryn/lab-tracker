# Трекер лабораторних

Вебзастосунок для обліку лабораторних робіт: предмети, лабораторні за темами, статуси («Не здано», «В роботі», «Здано»), дедлайни, план на тиждень і загальний прогрес.

- **Backend:** Python, FastAPI, MongoDB (pymongo)
- **Frontend:** HTML, CSS, JavaScript
- **CLI:** консольний клієнт на argparse і requests

## Запуск

1. Запустити MongoDB (локально: `brew services start mongodb-community`).
2. Встановити залежності:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. Запустити backend:
   ```bash
   cd backend
   uvicorn main:app --reload
   ```
4. Відкрити http://localhost:8000 (документація API — http://localhost:8000/docs).

Адресу бази можна змінити змінною середовища `MONGO_URL` (за замовчуванням `mongodb://localhost:27017`), назву бази — `DB_NAME` (за замовчуванням `lab_tracker`).

## CLI

```bash
python cli.py progress
python cli.py subjects
python cli.py add-lab НБД 1 "Основи нереляційних БД" --deadline 2026-11-25
python cli.py labs --subject НБД --status in_progress
```
