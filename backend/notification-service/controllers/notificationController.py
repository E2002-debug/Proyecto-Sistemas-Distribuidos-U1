import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'notifications.db')
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id   TEXT NOT NULL,
                message    TEXT NOT NULL,
                status     TEXT NOT NULL,
                type       TEXT DEFAULT 'info',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

def save_notification(order_id, message, status, ntype):
    with get_conn() as conn:
        cur = conn.execute(
            'INSERT INTO notifications (order_id,message,status,type) VALUES(?,?,?,?)',
            (order_id, message, status, ntype)
        )
        return cur.lastrowid

def all_notifications(order_id=None):
    with get_conn() as conn:
        if order_id:
            rows = conn.execute(
                'SELECT * FROM notifications WHERE order_id=? ORDER BY created_at DESC',
                (order_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100'
            ).fetchall()
        return [dict(r) for r in rows]
