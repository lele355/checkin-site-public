using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddGames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GameRooms",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Code = table.Column<string>(type: "TEXT", nullable: false),
                    GameKey = table.Column<string>(type: "TEXT", nullable: false),
                    HostUserId = table.Column<int>(type: "INTEGER", nullable: false),
                    GuestUserId = table.Column<int>(type: "INTEGER", nullable: true),
                    HostSide = table.Column<int>(type: "INTEGER", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    Turn = table.Column<int>(type: "INTEGER", nullable: false),
                    MovesJson = table.Column<string>(type: "TEXT", nullable: false),
                    Winner = table.Column<int>(type: "INTEGER", nullable: false),
                    ResultReason = table.Column<string>(type: "TEXT", nullable: false),
                    Revision = table.Column<int>(type: "INTEGER", nullable: false),
                    HostSeenAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    GuestSeenAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    FinishedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GameRooms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GameRooms_Users_GuestUserId",
                        column: x => x.GuestUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GameRooms_Users_HostUserId",
                        column: x => x.HostUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GameRooms_Code",
                table: "GameRooms",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GameRooms_GuestUserId",
                table: "GameRooms",
                column: "GuestUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GameRooms_HostUserId",
                table: "GameRooms",
                column: "HostUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GameRooms_Status_UpdatedAt",
                table: "GameRooms",
                columns: new[] { "Status", "UpdatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GameRooms");
        }
    }
}
