using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class DropPyLabModule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PyLabAttendances");

            migrationBuilder.DropTable(
                name: "PyLabSnippets");

            migrationBuilder.DropTable(
                name: "PyLabWpsMounts");

            migrationBuilder.DropTable(
                name: "PyLabStudents");

            migrationBuilder.DropTable(
                name: "PyLabSnippetCategories");

            migrationBuilder.DropTable(
                name: "PyLabWpsDecks");

            // 光删表不够：权限码从 PermissionCatalog 移除后，启动同步只「增」不「删」，
            // 库里那行 pylab.use 会永远留着；用户的侧栏偏好里也可能还勾着「Python 教学」
            // （点进去 404）。这里一并清干净。
            migrationBuilder.Sql(
                "DELETE FROM RolePermissions WHERE PermissionId IN (SELECT Id FROM Permissions WHERE Code = 'pylab.use');");
            migrationBuilder.Sql(
                "DELETE FROM Permissions WHERE Code = 'pylab.use';");
            // NavHidden 是 JSON 数组文本，用 JSON1 过滤掉 pylab 这一项；
            // 全被过滤光时兜一个空数组（CurrentUser 读空串/空数组都当「没隐藏」）
            migrationBuilder.Sql(
                "UPDATE Users SET NavHidden = COALESCE((SELECT json_group_array(value) FROM json_each(Users.NavHidden) WHERE value <> 'pylab'), '[]') " +
                "WHERE NavHidden IS NOT NULL AND NavHidden <> '' AND NavHidden LIKE '%pylab%';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PyLabSnippetCategories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabSnippetCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabSnippetCategories_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabStudents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    ClassName = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    StudentNo = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabStudents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabStudents_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabWpsDecks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Remark = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Url = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabWpsDecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabWpsDecks_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabSnippets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CategoryId = table.Column<int>(type: "INTEGER", nullable: true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Code = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Expect = table.Column<string>(type: "TEXT", nullable: false),
                    SourceFile = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabSnippets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabSnippets_PyLabSnippetCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "PyLabSnippetCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PyLabSnippets_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabAttendances",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    StudentId = table.Column<int>(type: "INTEGER", nullable: false),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    StudentName = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabAttendances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabAttendances_PyLabStudents_StudentId",
                        column: x => x.StudentId,
                        principalTable: "PyLabStudents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PyLabAttendances_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabWpsMounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    WpsDeckId = table.Column<int>(type: "INTEGER", nullable: false),
                    SnippetId = table.Column<string>(type: "TEXT", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabWpsMounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabWpsMounts_PyLabWpsDecks_WpsDeckId",
                        column: x => x.WpsDeckId,
                        principalTable: "PyLabWpsDecks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabAttendances_StudentId_CreatedAt",
                table: "PyLabAttendances",
                columns: new[] { "StudentId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabAttendances_UserId_CreatedAt",
                table: "PyLabAttendances",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabSnippetCategories_UserId_Name",
                table: "PyLabSnippetCategories",
                columns: new[] { "UserId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PyLabSnippets_CategoryId",
                table: "PyLabSnippets",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_PyLabSnippets_UserId_CategoryId",
                table: "PyLabSnippets",
                columns: new[] { "UserId", "CategoryId" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabSnippets_UserId_UpdatedAt",
                table: "PyLabSnippets",
                columns: new[] { "UserId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabStudents_UserId_ClassName",
                table: "PyLabStudents",
                columns: new[] { "UserId", "ClassName" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabStudents_UserId_SortOrder",
                table: "PyLabStudents",
                columns: new[] { "UserId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabWpsDecks_UserId_UpdatedAt",
                table: "PyLabWpsDecks",
                columns: new[] { "UserId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabWpsMounts_WpsDeckId_SnippetId",
                table: "PyLabWpsMounts",
                columns: new[] { "WpsDeckId", "SnippetId" },
                unique: true);
        }
    }
}
