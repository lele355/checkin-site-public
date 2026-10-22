using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddPyLabWpsDecks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PyLabWpsDecks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Url = table.Column<string>(type: "TEXT", nullable: false),
                    Remark = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
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
                name: "IX_PyLabWpsDecks_UserId_UpdatedAt",
                table: "PyLabWpsDecks",
                columns: new[] { "UserId", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabWpsMounts_WpsDeckId_SnippetId",
                table: "PyLabWpsMounts",
                columns: new[] { "WpsDeckId", "SnippetId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PyLabWpsMounts");

            migrationBuilder.DropTable(
                name: "PyLabWpsDecks");
        }
    }
}
