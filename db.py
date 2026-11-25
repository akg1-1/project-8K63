# db.py
import os
import sqlite3
import secrets
import hashlib
from datetime import datetime, timedelta


DB_NAME = os.getenv("DB_NAME", default="expenses.db")
SESSION_TTL_DAYS = os.getenv(int("SESSION_TTL_DAYS"), default=30)


def get_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                name          TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt          TEXT NOT NULL,
                created_at    TEXT NOT NULL
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                category_id TEXT NOT NULL DEFAULT 'other',
                title       TEXT NOT NULL,
                amount      REAL NOT NULL,
                date        TEXT NOT NULL,
                time        TEXT,
                note        TEXT,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_tx_user_date "
                    "ON transactions(user_id, date)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS budgets (
                user_id     TEXT NOT NULL,
                category_id TEXT NOT NULL,
                amount      REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, category_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                user_id        TEXT PRIMARY KEY,
                name           TEXT,
                monthly_budget REAL DEFAULT 0,
                currency       TEXT DEFAULT '₽',
                chart_country  TEXT DEFAULT 'ru',
                created_at     TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS picks (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                category_id TEXT NOT NULL,
                title       TEXT NOT NULL,
                url         TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        conn.commit()
        print("✅ База данных инициализирована (users, sessions, "
              "transactions, budgets, settings, picks)")


# ---------------- Пароли ----------------

def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000
    ).hex()


def create_user(name: str, password: str) -> dict:
    name = name.strip()
    if len(name) < 2:
        raise ValueError("Имя — минимум 2 символа")
    if len(password) < 4:
        raise ValueError("Пароль — минимум 4 символа")

    salt = secrets.token_hex(16)
    pwd_hash = _hash(password, salt)
    user_id = "u" + secrets.token_hex(8)
    now = datetime.utcnow().isoformat(timespec="seconds")

    with get_connection() as conn:
        try:
            conn.execute(
                "INSERT INTO users (id, name, password_hash, salt, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, name, pwd_hash, salt, now),
            )
        except sqlite3.IntegrityError:
            raise ValueError("Это имя уже занято")

        conn.execute(
            "INSERT INTO settings "
            "(user_id, name, monthly_budget, currency, chart_country, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, name, 70000.0, "₽", "ru", now),
        )
        conn.commit()
    return {"id": user_id, "name": name, "createdAt": now}


def verify_user(name: str, password: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE name = ? COLLATE NOCASE", (name.strip(),)
        ).fetchone()
        if not row:
            return None
        if _hash(password, row["salt"]) != row["password_hash"]:
            return None
        return {"id": row["id"], "name": row["name"], "createdAt": row["created_at"]}


def delete_user(user_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()


# ---------------- Сессии ----------------

def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    expires = now + timedelta(days=SESSION_TTL_DAYS)
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (token, user_id,
             now.isoformat(timespec="seconds"),
             expires.isoformat(timespec="seconds")),
        )
        conn.commit()
    return token


def get_user_by_token(token: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT u.id, u.name, u.created_at, s.expires_at "
            "FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < datetime.utcnow().isoformat(timespec="seconds"):
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return None
        return {"id": row["id"], "name": row["name"], "createdAt": row["created_at"]}


def delete_session(token: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


# ---------------- Полное состояние пользователя ----------------

def get_state(user_id: str) -> dict:
    with get_connection() as conn:
        tx_rows = conn.execute(
            "SELECT id, category_id, title, amount, date, time, note "
            "FROM transactions WHERE user_id = ? "
            "ORDER BY date DESC, time DESC",
            (user_id,),
        ).fetchall()

        transactions = [
            {
                "id": r["id"],
                "categoryId": r["category_id"],
                "title": r["title"],
                "amount": r["amount"],
                "date": r["date"],
                "time": r["time"] or "12:00",
                "note": r["note"] or "",
            }
            for r in tx_rows
        ]

        budgets = {
            r["category_id"]: r["amount"]
            for r in conn.execute(
                "SELECT category_id, amount FROM budgets WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        }

        s = conn.execute(
            "SELECT * FROM settings WHERE user_id = ?", (user_id,)
        ).fetchone()
        settings = (
            {
                "name": s["name"],
                "monthlyBudget": s["monthly_budget"],
                "currency": s["currency"],
                "chartCountry": s["chart_country"],
                "createdAt": s["created_at"],
            }
            if s
            else {}
        )

        picks: dict[str, list[dict]] = {}
        for r in conn.execute(
            "SELECT category_id, title, url FROM picks WHERE user_id = ? "
            "ORDER BY created_at",
            (user_id,),
        ).fetchall():
            picks.setdefault(r["category_id"], []).append(
                {"title": r["title"], "url": r["url"]}
            )

    return {
        "transactions": transactions,
        "budgets": budgets,
        "settings": settings,
        "picks": picks,
    }


def replace_state(user_id: str, payload: dict) -> None:
    """Полная замена состояния пользователя (upsert-all через delete+insert)."""
    now = datetime.utcnow().isoformat(timespec="seconds")

    with get_connection() as conn:
        # сохраняем исходный created_at, если запись уже была
        prev_settings = conn.execute(
            "SELECT created_at FROM settings WHERE user_id = ?", (user_id,)
        ).fetchone()

        # --- transactions ---
        conn.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
        for t in payload.get("transactions", []):
            tid = str(t.get("id") or ("tx" + secrets.token_hex(6)))
            conn.execute(
                "INSERT INTO transactions "
                "(id, user_id, category_id, title, amount, date, time, note, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    tid,
                    user_id,
                    str(t.get("categoryId") or "other"),
                    str(t.get("title") or "Трата"),
                    float(t.get("amount") or 0),
                    str(t.get("date") or now[:10]),
                    str(t.get("time") or "12:00"),
                    str(t.get("note") or ""),
                    now,
                ),
            )

        # --- budgets ---
        conn.execute("DELETE FROM budgets WHERE user_id = ?", (user_id,))
        for cid, amount in (payload.get("budgets") or {}).items():
            conn.execute(
                "INSERT INTO budgets (user_id, category_id, amount) VALUES (?, ?, ?)",
                (user_id, str(cid), float(amount or 0)),
            )

        # --- settings ---
        s = payload.get("settings") or {}
        created = (
            prev_settings["created_at"]
            if prev_settings
            else (s.get("createdAt") or now)
        )
        conn.execute("DELETE FROM settings WHERE user_id = ?", (user_id,))
        conn.execute(
            "INSERT INTO settings "
            "(user_id, name, monthly_budget, currency, chart_country, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                user_id,
                str(s.get("name") or ""),
                float(s.get("monthlyBudget") or 0),
                str(s.get("currency") or "₽"),
                str(s.get("chartCountry") or "ru"),
                created,
            ),
        )

        # --- picks ---
        conn.execute("DELETE FROM picks WHERE user_id = ?", (user_id,))
        for cid, arr in (payload.get("picks") or {}).items():
            for p in arr:
                conn.execute(
                    "INSERT INTO picks (id, user_id, category_id, title, url, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("pk" + secrets.token_hex(6), user_id, str(cid),
                     str(p.get("title") or ""), str(p.get("url") or ""), now),
                )

        conn.commit()


# ---------------- Статистика ----------------

def get_monthly_stats(user_id: str, month: str) -> dict:
    with get_connection() as conn:
        total = conn.execute(
            "SELECT SUM(amount) FROM transactions "
            "WHERE user_id = ? AND date LIKE ?",
            (user_id, f"{month}%"),
        ).fetchone()[0] or 0.0

        srow = conn.execute(
            "SELECT monthly_budget FROM settings WHERE user_id = ?", (user_id,)
        ).fetchone()
        budget = srow["monthly_budget"] if srow else 0.0

        return {
            "month": month,
            "budget": budget,
            "total_spent": total,
            "remaining": budget - total,
        }


