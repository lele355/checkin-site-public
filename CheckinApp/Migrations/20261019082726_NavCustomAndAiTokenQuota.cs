using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class NavCustomAndAiTokenQuota : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NavHidden",
                table: "Users",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "AiUsageDailies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Day = table.Column<DateTime>(type: "TEXT", nullable: false),
                    PromptTokens = table.Column<long>(type: "INTEGER", nullable: false),
                    CompletionTokens = table.Column<long>(type: "INTEGER", nullable: false),
                    TotalTokens = table.Column<long>(type: "INTEGER", nullable: false),
                    Requests = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiUsageDailies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AiUsageDailies_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiUsageDailies_UserId_Day",
                table: "AiUsageDailies",
                columns: new[] { "UserId", "Day" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiUsageDailies");

            migrationBuilder.DropColumn(
                name: "NavHidden",
                table: "Users");
        }
    }
}
