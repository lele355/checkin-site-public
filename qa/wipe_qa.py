# -*- coding: utf-8 -*-
"""wipe_qa.py — 清理 QA 测试账号及其全部业务数据（演示数据 admin 不动）。
每轮测试开跑前执行，保证三轮互相独立。"""
import sqlite3

DB = 'D:/projects/checkin/CheckinApp/data/checkin.db'

DEL_TABLES_USER = [
    ('AiMessages', 'UserId'), ('Anniversaries', 'UserId'), ('BoardMessages', 'UserId'),
    ('Courses', 'UserId'), ('Expenses', 'UserId'), ('HabitCheckins', 'UserId'),
    ('Habits', 'UserId'), ('Memos', 'UserId'), ('PeriodRecords', 'UserId'),
    ('Schedules', 'UserId'), ('LoveNotes', 'FromUserId'),
    ('EmailMessages', 'UserId'), ('EmailAccounts', 'UserId'),
]

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    uids = [r[0] for r in cur.execute(
        "select Id from Users where Username like 'QA_%' or Username like 'QA-%'").fetchall()]
    total = 0
    for uid in uids:
        for table, col in DEL_TABLES_USER:
            cur.execute(f"delete from {table} where {col}=?", (uid,))
            total += conn.total_changes
        cur.execute("delete from Users where Id=?", (uid,))
    # 情侣留言若全是 QA 发的且 admin 未参与也一并清（LoveNotes 已按 FromUserId 清）
    conn.commit()
    left = cur.execute("select count(*) from Users where Username like 'QA_%'").fetchone()[0]
    print(f"wiped users={len(uids)} rows~{total} qa_users_left={left}")
    conn.close()

if __name__ == '__main__':
    main()
