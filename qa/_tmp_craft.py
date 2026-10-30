import sqlite3
c = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')
c.execute("""update GameRooms set MovesJson='[{"t":"setup","s":2,"x":0,"y":0,"v":7},{"t":"setup","s":2,"x":6,"y":0,"v":6},{"t":"setup","s":2,"x":1,"y":1,"v":3},{"t":"setup","s":2,"x":5,"y":1,"v":2},{"t":"setup","s":2,"x":0,"y":2,"v":1},{"t":"setup","s":2,"x":2,"y":2,"v":5},{"t":"setup","s":2,"x":4,"y":2,"v":4},{"t":"setup","s":2,"x":6,"y":2,"v":8}]', Turn=2, Status='playing', Revision=10 where Id=2129""")
c.commit()
c.close()