using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class AddInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "PendingApproval",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "RegisterIp",
                table: "Users",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "Invitations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Code = table.Column<string>(type: "TEXT", nullable: false),
                    Note = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "INTEGER", nullable: true),
                    RoleId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UsedByUserId = table.Column<int>(type: "INTEGER", nullable: true),
                    UsedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Revoked = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Invitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Invitations_Roles_RoleId",
                        column: x => x.RoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invitations_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Invitations_Users_UsedByUserId",
                        column: x => x.UsedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_Code",
                table: "Invitations",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_CreatedByUserId",
                table: "Invitations",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_ExpiresAt",
                table: "Invitations",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_RoleId",
                table: "Invitations",
                column: "RoleId");

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_UsedByUserId",
                table: "Invitations",
                column: "UsedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Invitations");

            migrationBuilder.DropColumn(
                name: "PendingApproval",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "RegisterIp",
                table: "Users");
        }
    }
}
