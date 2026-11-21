using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddSleepWindow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SleepEndAt",
                table: "HealthDailies",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SleepStartAt",
                table: "HealthDailies",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SleepEndAt",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "SleepStartAt",
                table: "HealthDailies");
        }
    }
}
