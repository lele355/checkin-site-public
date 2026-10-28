using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddGameSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GameSettings",
                table: "Users",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "Forbidden",
                table: "GameRooms",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "GuestUsedMs",
                table: "GameRooms",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "HostUsedMs",
                table: "GameRooms",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "MoveTimeoutSec",
                table: "GameRooms",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Size",
                table: "GameRooms",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TotalTimeoutSec",
                table: "GameRooms",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "TurnStartedAt",
                table: "GameRooms",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GameSettings",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Forbidden",
                table: "GameRooms");

            migrationBuilder.DropColumn(
                name: "GuestUsedMs",
                table: "GameRooms");

            migrationBuilder.DropColumn(
                name: "HostUsedMs",
                table: "GameRooms");

            migrationBuilder.DropColumn(
                name: "MoveTimeoutSec",
                table: "GameRooms");

            migrationBuilder.DropColumn(
                name: "Size",
                table: "GameRooms");

            migrationBuilder.DropColumn(
                name: "TotalTimeoutSec",
                table: "GameRooms");

            migrationBuilder.DropColumn(
                name: "TurnStartedAt",
                table: "GameRooms");
        }
    }
}
