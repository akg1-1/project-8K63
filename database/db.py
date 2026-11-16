import sqlite3
from datetime import datetime, timedelta

DB_NAME = "expenses.db"


def get_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()

        # Создание таблиц
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);")
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS category_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT UNIQUE NOT NULL, category_id INTEGER NOT NULL, FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE);")
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, amount REAL NOT NULL, description TEXT NOT NULL, date TEXT NOT NULL, category_id INTEGER, FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL);")
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT UNIQUE NOT NULL, limit_amount REAL NOT NULL);")

        cursor.execute("SELECT COUNT(*) FROM categories")
        if cursor.fetchone()[0] == 0:
            categories = [("Еда",), ("Транспорт",), ("Жилье",), ("Развлечения",), ("Другое",)]
            cursor.executemany("INSERT INTO categories (name) VALUES (?)", categories)

            cursor.execute("SELECT id, name FROM categories")
            cat_dict = {row["name"]: row["id"] for row in cursor.fetchall()}

            rules = [
                ("продукты", cat_dict["Еда"]), ("кафе", cat_dict["Еда"]), ("ресторан", cat_dict["Еда"]),
                ("такси", cat_dict["Транспорт"]), ("метро", cat_dict["Транспорт"]), ("бензин", cat_dict["Транспорт"]),
                ("аренда", cat_dict["Жилье"]), ("квартира", cat_dict["Жилье"]),
                ("кино", cat_dict["Развлечения"]), ("игры", cat_dict["Развлечения"])
            ]
            cursor.executemany("INSERT INTO category_rules (keyword, category_id) VALUES (?, ?)", rules)

        conn.commit()
        print("✅ База данных успешно инициализирована.")


def determine_category(description: str) -> int:
    with get_connection() as conn:
        desc_lower = description.lower()
        for row in conn.execute("SELECT keyword, category_id FROM category_rules"):
            if row["keyword"] in desc_lower:
                return row["category_id"]
        return conn.execute("SELECT id FROM categories WHERE name = 'Другое'").fetchone()["id"]


def add_expense(amount: float, description: str, date: str = None):
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")
    cat_id = determine_category(description)
    with get_connection() as conn:
        conn.execute("INSERT INTO expenses (amount, description, date, category_id) VALUES (?, ?, ?, ?)",
                     (amount, description, date, cat_id))
        conn.commit()


def get_monthly_stats(month: str):
    with get_connection() as conn:
        total_spent = conn.execute("SELECT SUM(amount) FROM expenses WHERE date LIKE ?", (f"{month}%",)).fetchone()[
                          0] or 0.0
        budget_row = conn.execute("SELECT limit_amount FROM budgets WHERE month = ?", (month,)).fetchone()
        budget = budget_row["limit_amount"] if budget_row else 0.0
        return {"budget": budget, "total_spent": total_spent, "remaining": budget - total_spent}

if __name__ == "__main__":
    init_db()
    current_month = datetime.now().strftime("%Y-%m")

    with get_connection() as conn:
        conn.execute("INSERT OR REPLACE INTO budgets (month, limit_amount) VALUES (?, ?)", (current_month, 50000.0))
        conn.execute("DELETE FROM expenses")
        conn.commit()

    print("\nДобавляем тестовые траты...")

    test_expenses = [
        (1200, "Продукты в Пятерочке", 1),
        (450, "Такси до дома", 1),
        (3500, "Аренда квартиры", 2),
        (800, "Обед в кафе", 3),
        (150, "Метро (проездной)", 3),
        (2500, "Кино и попкорн", 4),
        (3200, "Бензин на заправке", 5),
        (4000, "Игры в Steam", 10)
    ]

    for amount, desc, days_ago in test_expenses:
        exp_date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
        add_expense(amount, desc, exp_date)
        print(f" + [{exp_date}] {desc} - {amount} руб.")

    print("\n✅ База данных заполнена!")

    # Вывод результатов
    stats = get_monthly_stats(current_month)
    print("\n📊 Статистика за месяц:")
    print(f"Бюджет: {stats['budget']} руб.")
    print(f"Потрачено: {stats['total_spent']} руб.")
    print(f"Остаток: {stats['remaining']} руб.")