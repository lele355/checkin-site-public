import sqlite3
c = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')
c.execute("""update GameRooms set MovesJson='[{"x":7,"y":7,"s":1},{"x":0,"y":0,"s":2}]', Revision=10 where Id=2644""")
c.commit()
c.close()