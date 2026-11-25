from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import db

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db.init_db()

class ExpenseCreate(BaseModel):
    amount: float
    description: str
    date: Optional[str] = None

@app.post("/api/expenses")
def create_expense(item: ExpenseCreate):
    """Добавить новую трату"""
    db.add_expense(item.amount, item.description, item.date)
    return {"status": "ok", "message": "Трата добавлена"}

@app.get("/api/expenses")
def read_expenses(month: str = None):
    """Получить список трат (можно с фильтром по месяцу, например '2026-11')"""
    return db.get_expenses(month)

@app.get("/api/stats")
def get_stats():
    """Получить общую статистику за текущий месяц"""
    from datetime import datetime
    current_month = datetime.now().strftime("%Y-%m")
    return db.get_monthly_stats(current_month)