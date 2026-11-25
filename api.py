# main.py
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import secrets
import db

app = FastAPI(title="Cashfy API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db.init_db()


# ---------------- auth-зависимость ----------------

def current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Нужна авторизация")
    token = authorization[7:].strip()
    user = db.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Сессия истекла")
    user["_token"] = token
    return user


# ---------------- модели ----------------

class AuthIn(BaseModel):
    name: str
    password: str


class TransactionIn(BaseModel):
    id: Optional[str] = None
    categoryId: Optional[str] = "other"
    title: str = "Трата"
    amount: float
    date: str
    time: Optional[str] = "12:00"
    note: Optional[str] = ""


class StateIn(BaseModel):
    transactions: List[TransactionIn] = []
    budgets: Dict[str, float] = {}
    settings: Dict[str, Any] = {}
    picks: Dict[str, List[Dict[str, str]]] = {}


# ---------------- auth ----------------

@app.post("/api/auth/register")
def register(payload: AuthIn):
    try:
        user = db.create_user(payload.name, payload.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    token = db.create_session(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/login")
def login(payload: AuthIn):
    user = db.verify_user(payload.name, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Неверное имя или пароль")
    token = db.create_session(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/guest")
def guest_login():
    name = "Гость-" + secrets.token_hex(3)
    user = db.create_user(name, secrets.token_hex(16))
    token = db.create_session(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/logout")
def logout(user: dict = Depends(current_user)):
    db.delete_session(user["_token"])
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {"id": user["id"], "name": user["name"], "createdAt": user["createdAt"]}


@app.delete("/api/auth/me")
def delete_me(user: dict = Depends(current_user)):
    db.delete_user(user["id"])
    return {"status": "ok"}


# ---------------- state ----------------

@app.get("/api/state")
def read_state(user: dict = Depends(current_user)):
    """Полное состояние пользователя для гидратации клиента."""
    return db.get_state(user["id"])


@app.put("/api/state")
def write_state(payload: StateIn, user: dict = Depends(current_user)):
    """Полная замена состояния (используется фронтом при каждом изменении)."""
    db.replace_state(user["id"], payload.model_dump())
    return {"status": "ok"}


# ---------------- stats ----------------

@app.get("/api/stats")
def stats(month: Optional[str] = None, user: dict = Depends(current_user)):
    m = month or datetime.now().strftime("%Y-%m")
    return db.get_monthly_stats(user["id"], m)


# ---------------- health ----------------

@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}