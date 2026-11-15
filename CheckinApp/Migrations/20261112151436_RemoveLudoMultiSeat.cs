using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class RemoveLudoMultiSeat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 飞行棋整款下架（2026-11-12）：先清掉它的房间与分数。
            // 站主明确「无需备份、完全删除」，所以这里不做数据保留。
            migrationBuilder.Sql("DELETE FROM \"GameRooms\" WHERE \"GameKey\" = 'ludo';");
            migrationBuilder.Sql("DELETE FROM \"GameScores\" WHERE \"GameKey\" = 'ludo';");

            // 用 SQLite 原生 DROP COLUMN，而不是 migrationBuilder.DropColumn：
            // EF 的 SQLite 提供程序删列时会「建临时表 → 全量拷贝 → 换名」，
            // 拷贝过程会重新校验 FOREIGN KEY，存量里只要有一行房间指向已删用户就整笔迁移失败
            // （本地实测：FOREIGN KEY constraint failed，站点直接起不来）。
            // 原生 DROP COLUMN 原地改表，不搬数据行。
            migrationBuilder.Sql("ALTER TABLE \"GameRooms\" DROP COLUMN \"SeatsJson\";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"GameRooms\" ADD COLUMN \"SeatsJson\" TEXT NULL;");
        }
    }
}
