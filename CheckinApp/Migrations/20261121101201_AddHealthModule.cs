using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddHealthModule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HealthBindings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    BridgeBindingKey = table.Column<string>(type: "TEXT", nullable: false),
                    DisplayName = table.Column<string>(type: "TEXT", nullable: false),
                    OwnerName = table.Column<string>(type: "TEXT", nullable: false),
                    MiUserId = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    LastSyncAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    LastSyncError = table.Column<string>(type: "TEXT", nullable: false),
                    SyncCursor = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HealthBindings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HealthBindings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "HealthDailies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    BindingId = table.Column<int>(type: "INTEGER", nullable: false),
                    Date = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Steps = table.Column<int>(type: "INTEGER", nullable: false),
                    DistanceM = table.Column<double>(type: "REAL", nullable: false),
                    CaloriesTotal = table.Column<double>(type: "REAL", nullable: false),
                    CaloriesActive = table.Column<double>(type: "REAL", nullable: false),
                    ActivityCount = table.Column<int>(type: "INTEGER", nullable: false),
                    ActivityMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    HrAvg = table.Column<double>(type: "REAL", nullable: false),
                    HrMax = table.Column<double>(type: "REAL", nullable: false),
                    HrMin = table.Column<double>(type: "REAL", nullable: false),
                    HrResting = table.Column<double>(type: "REAL", nullable: false),
                    Spo2Avg = table.Column<double>(type: "REAL", nullable: false),
                    StressAvg = table.Column<double>(type: "REAL", nullable: false),
                    SleepMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    SleepScore = table.Column<double>(type: "REAL", nullable: false),
                    WeightKg = table.Column<double>(type: "REAL", nullable: false),
                    WorkoutCount = table.Column<int>(type: "INTEGER", nullable: false),
                    RawJson = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HealthDailies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HealthDailies_HealthBindings_BindingId",
                        column: x => x.BindingId,
                        principalTable: "HealthBindings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_HealthDailies_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HealthBindings_BridgeBindingKey",
                table: "HealthBindings",
                column: "BridgeBindingKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HealthBindings_UserId",
                table: "HealthBindings",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_HealthDailies_BindingId_Date",
                table: "HealthDailies",
                columns: new[] { "BindingId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HealthDailies_UserId_Date",
                table: "HealthDailies",
                columns: new[] { "UserId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HealthDailies");

            migrationBuilder.DropTable(
                name: "HealthBindings");
        }
    }
}
