using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddNotifySettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NotifySettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    DndEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    DndStartMinute = table.Column<int>(type: "INTEGER", nullable: false),
                    DndEndMinute = table.Column<int>(type: "INTEGER", nullable: false),
                    ScheduleEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    ScheduleLeads = table.Column<string>(type: "TEXT", nullable: false),
                    AllDayMinute = table.Column<int>(type: "INTEGER", nullable: false),
                    DigestEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    DigestMinute = table.Column<int>(type: "INTEGER", nullable: false),
                    HabitEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    HabitMinute = table.Column<int>(type: "INTEGER", nullable: false),
                    AnnivEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    AnnivMinute = table.Column<int>(type: "INTEGER", nullable: false),
                    PeriodEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    PeriodDaysBefore = table.Column<int>(type: "INTEGER", nullable: false),
                    UnreadHint = table.Column<bool>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotifySettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NotifySettings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NotifySettings_UserId",
                table: "NotifySettings",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotifySettings");
        }
    }
}
