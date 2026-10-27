# -*- coding: utf-8 -*-
"""dbq.py — 测试用 SQLite 即时查询工具。
用法: echo "SELECT ..." | python dbq.py   → stdout 为 JSON 数组（列名:值）。
供 qa_full.js 里 execSync 调用做落库数据验证。"""
import sys, json, sqlite3

import os
DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'CheckinApp', 'data', 'checkin.db')

def main():
    sql = sys.stdin.read().strip()
    if not sql:
        print(json.dumps({"error": "empty sql"}))
        return
    try:
        conn = sqlite3.connect(DB)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql)
        if sql.lstrip().lower().startswith(('select', 'pragma')):
            rows = [dict(r) for r in cur.fetchall()]
            print(json.dumps(rows, ensure_ascii=False, default=str))
        else:
            conn.commit()
            print(json.dumps({"changed": conn.total_changes}, ensure_ascii=False))
        conn.close()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
