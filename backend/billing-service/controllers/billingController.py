import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'billing.db')
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS invoices (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id  TEXT NOT NULL,
                event     TEXT NOT NULL,
                customer  TEXT,
                address   TEXT,
                amount    REAL DEFAULT 0.0,
                retries   INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

def save_invoice(order_id, event, customer, address, amount, retries=0):
    with get_conn() as conn:
        cur = conn.execute(
            'INSERT INTO invoices (order_id,event,customer,address,amount,retries) VALUES(?,?,?,?,?,?)',
            (order_id, event, customer, address, amount, retries)
        )
        return cur.lastrowid

def get_all_invoices():
    with get_conn() as conn:
        rows = conn.execute('SELECT * FROM invoices ORDER BY created_at DESC').fetchall()
        return [dict(r) for r in rows]

def get_invoices_by_order(order_id):
    return [i for i in get_all_invoices() if i['order_id'] == order_id]
