using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddHealthDetail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SleepAwakeMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SleepDeepMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SleepLightMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SleepRemMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StressMildMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StressModerateMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StressRelaxedMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StressSevereMin",
                table: "HealthDailies",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "HealthHourlies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    BindingId = table.Column<int>(type: "INTEGER", nullable: false),
                    Date = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Hour = table.Column<int>(type: "INTEGER", nullable: false),
                    HrMin = table.Column<double>(type: "REAL", nullable: false),
                    HrMax = table.Column<double>(type: "REAL", nullable: false),
                    HrAvg = table.Column<double>(type: "REAL", nullable: false),
                    HrPoints = table.Column<int>(type: "INTEGER", nullable: false),
                    Spo2Min = table.Column<double>(type: "REAL", nullable: false),
                    Spo2Max = table.Column<double>(type: "REAL", nullable: false),
                    Spo2Avg = table.Column<double>(type: "REAL", nullable: false),
                    Spo2Points = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HealthHourlies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HealthHourlies_HealthBindings_BindingId",
                        column: x => x.BindingId,
                        principalTable: "HealthBindings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_HealthHourlies_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "HealthWeightLogs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Date = table.Column<DateTime>(type: "TEXT", nullable: false),
                    WeightKg = table.Column<double>(type: "REAL", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HealthWeightLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HealthWeightLogs_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HealthHourlies_BindingId_Date_Hour",
                table: "HealthHourlies",
                columns: new[] { "BindingId", "Date", "Hour" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HealthHourlies_UserId",
                table: "HealthHourlies",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_HealthWeightLogs_UserId_Date",
                table: "HealthWeightLogs",
                columns: new[] { "UserId", "Date" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HealthHourlies");

            migrationBuilder.DropTable(
                name: "HealthWeightLogs");

            migrationBuilder.DropColumn(
                name: "SleepAwakeMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "SleepDeepMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "SleepLightMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "SleepRemMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "StressMildMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "StressModerateMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "StressRelaxedMin",
                table: "HealthDailies");

            migrationBuilder.DropColumn(
                name: "StressSevereMin",
                table: "HealthDailies");
        }
    }
}
