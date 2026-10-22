using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class DropLocalDeckLibrary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PyLabDeckSnippets");

            migrationBuilder.DropTable(
                name: "PyLabDecks");

            migrationBuilder.DropTable(
                name: "PyLabDeckCategories");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PyLabDeckCategories",
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
                    table.PrimaryKey("PK_PyLabDeckCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabDeckCategories_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabDecks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CategoryId = table.Column<int>(type: "INTEGER", nullable: true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Engine = table.Column<string>(type: "TEXT", nullable: false),
                    Error = table.Column<string>(type: "TEXT", nullable: false),
                    OriginalFileName = table.Column<string>(type: "TEXT", nullable: false),
                    PageCount = table.Column<int>(type: "INTEGER", nullable: false),
                    SizeBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabDecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabDecks_PyLabDeckCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "PyLabDeckCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PyLabDecks_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PyLabDeckSnippets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    DeckId = table.Column<int>(type: "INTEGER", nullable: false),
                    PageNo = table.Column<int>(type: "INTEGER", nullable: false),
                    SnippetId = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PyLabDeckSnippets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PyLabDeckSnippets_PyLabDecks_DeckId",
                        column: x => x.DeckId,
                        principalTable: "PyLabDecks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabDeckCategories_UserId_Name",
                table: "PyLabDeckCategories",
                columns: new[] { "UserId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PyLabDecks_CategoryId",
                table: "PyLabDecks",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_PyLabDecks_UserId_CategoryId",
                table: "PyLabDecks",
                columns: new[] { "UserId", "CategoryId" });

            migrationBuilder.CreateIndex(
                name: "IX_PyLabDeckSnippets_DeckId_PageNo",
                table: "PyLabDeckSnippets",
                columns: new[] { "DeckId", "PageNo" },
                unique: true);
        }
    }
}
