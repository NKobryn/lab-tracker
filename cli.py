
"""CLI трекера лабораторних: працює з тим самим backend, що й вебсторінка.
Приклади:
    python cli.py progress
    python cli.py subjects
    python cli.py add-subject "НБД" --teacher "Жишкович А. В."
    python cli.py add-lab НБД 1 "Основи нереляційних БД" --deadline 2026-11-25
    python cli.py labs --subject НБД --status in_progress
    python cli.py status НБД 1 done
    python cli.py week НБД 1 on
    python cli.py deadline НБД 1 2026-11-30
"""
import argparse
import sys

import requests

API = "http://127.0.0.1:8000/api"
ICONS = {"not_done": "[ ]", "in_progress": "[~]", "done": "[x]"}  # позначки статусів
NAMES = {"not_done": "Не здано", "in_progress": "В роботі", "done": "Здано"}


def call(method, path, **kwargs):
    """Запит до backend; якщо помилка — показуємо її і виходимо."""
    try:
        response = requests.request(method, API + path, timeout=5, **kwargs)
    except requests.ConnectionError:
        sys.exit("Backend не запущено. Запусти: cd backend && uvicorn main:app --reload")
    if not response.ok:
        sys.exit(f"Помилка {response.status_code}: {response.json().get('detail')}")
    return response.json()


def find_subject(name):
    """Знаходить предмет за назвою (без урахування регістру)."""
    for s in call("GET", "/subjects"):
        if s["name"].lower() == name.lower():
            return s
    sys.exit(f"Предмет «{name}» не знайдено")


def find_lab(subject_name, number):
    subject = find_subject(subject_name)
    for lab in call("GET", "/labs", params={"subject_id": subject["id"]}):
        if lab["number"] == number:
            return lab
    sys.exit(f"У предметі «{subject_name}» немає лаби №{number}")


def print_labs(labs, subjects):
    names = {s["id"]: s["name"] for s in subjects}
    if not labs:
        print("Лабораторних немає")
    for lab in labs:
        star = "*" if lab["this_week"] else " "  # * — заплановано на цей тиждень
        deadline = lab["deadline"] or "—"
        print(f"{ICONS[lab['status']]} {star} {names[lab['subject_id']]:<10} №{lab['number']:<3} "
              f"{lab['title']:<45} {NAMES[lab['status']]:<9} дедлайн: {deadline}")


# ---------- Команди ----------

def cmd_progress(args):
    p = call("GET", "/progress")
    print(f"Загальний прогрес: здано {p['done']} з {p['total']} ({p['percent']}%)")
    print(f"Здано: {p['done']}   В роботі: {p['in_progress']}   Не здано: {p['not_done']}")
    print(f"На цей тиждень: {p['this_week']}   Прострочено: {p['overdue']}")


def cmd_subjects(args):
    for s in call("GET", "/subjects"):
        print(f"{s['name']:<12} здано {s['done']}/{s['total']}  {s['teacher']}")


def cmd_add_subject(args):
    call("POST", "/subjects", json={"name": args.name, "teacher": args.teacher})
    print(f"Додано предмет «{args.name}»")


def cmd_labs(args):
    params = {}
    if args.subject:
        params["subject_id"] = find_subject(args.subject)["id"]
    if args.status:
        params["status"] = args.status
    if args.week:
        params["this_week"] = "true"
    print_labs(call("GET", "/labs", params=params), call("GET", "/subjects"))


def cmd_add_lab(args):
    subject = find_subject(args.subject)
    call("POST", "/labs", json={
        "subject_id": subject["id"], "number": args.number, "title": args.title,
        "deadline": args.deadline, "this_week": args.week,
    })
    print(f"Додано: {subject['name']} №{args.number} «{args.title}»")


def cmd_status(args):
    lab = find_lab(args.subject, args.number)
    call("PUT", f"/labs/{lab['id']}", json={"status": args.status})
    print(f"{args.subject} №{args.number}: статус «{NAMES[args.status]}»")


def cmd_week(args):
    lab = find_lab(args.subject, args.number)
    call("PUT", f"/labs/{lab['id']}", json={"this_week": args.state == "on"})
    print(f"{args.subject} №{args.number}: " + ("додано в план на тиждень" if args.state == "on" else "прибрано з плану"))


def cmd_deadline(args):
    lab = find_lab(args.subject, args.number)
    call("PUT", f"/labs/{lab['id']}", json={"deadline": args.date})
    print(f"{args.subject} №{args.number}: дедлайн {args.date}")


def cmd_delete_lab(args):
    lab = find_lab(args.subject, args.number)
    call("DELETE", f"/labs/{lab['id']}")
    print(f"Видалено: {args.subject} №{args.number}")


# ---------- Розбір аргументів командного рядка ----------

parser = argparse.ArgumentParser(description="Трекер лабораторних (CLI)")
sub = parser.add_subparsers(dest="command", required=True)

sub.add_parser("progress", help="загальний прогрес").set_defaults(func=cmd_progress)
sub.add_parser("subjects", help="список предметів").set_defaults(func=cmd_subjects)

p = sub.add_parser("add-subject", help="додати предмет")
p.add_argument("name")
p.add_argument("--teacher", default="")
p.set_defaults(func=cmd_add_subject)

p = sub.add_parser("labs", help="список лаб з фільтрами")
p.add_argument("--subject")
p.add_argument("--status", choices=NAMES)
p.add_argument("--week", action="store_true", help="лише заплановані на цей тиждень")
p.set_defaults(func=cmd_labs)

p = sub.add_parser("add-lab", help="додати лабу")
p.add_argument("subject")
p.add_argument("number", type=int)
p.add_argument("title")
p.add_argument("--deadline", help="РРРР-ММ-ДД")
p.add_argument("--week", action="store_true", help="одразу додати в план на тиждень")
p.set_defaults(func=cmd_add_lab)

p = sub.add_parser("status", help="змінити статус")
p.add_argument("subject")
p.add_argument("number", type=int)
p.add_argument("status", choices=NAMES)
p.set_defaults(func=cmd_status)

p = sub.add_parser("week", help="додати/прибрати з плану на тиждень")
p.add_argument("subject")
p.add_argument("number", type=int)
p.add_argument("state", choices=["on", "off"])
p.set_defaults(func=cmd_week)

p = sub.add_parser("deadline", help="поставити дедлайн")
p.add_argument("subject")
p.add_argument("number", type=int)
p.add_argument("date", help="РРРР-ММ-ДД")
p.set_defaults(func=cmd_deadline)

p = sub.add_parser("delete-lab", help="видалити лабу")
p.add_argument("subject")
p.add_argument("number", type=int)
p.set_defaults(func=cmd_delete_lab)

args = parser.parse_args()
args.func(args)