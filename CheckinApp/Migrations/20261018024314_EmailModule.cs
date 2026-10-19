using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class EmailModule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    DisplayName = table.Column<string>(type: "TEXT", nullable: false),
                    Address = table.Column<string>(type: "TEXT", nullable: false),
                    Provider = table.Column<string>(type: "TEXT", nullable: false),
                    ImapHost = table.Column<string>(type: "TEXT", nullable: false),
                    ImapPort = table.Column<int>(type: "INTEGER", nullable: false),
                    SmtpHost = table.Column<string>(type: "TEXT", nullable: false),
                    SmtpPort = table.Column<int>(type: "INTEGER", nullable: false),
                    AuthCodeEnc = table.Column<string>(type: "TEXT", nullable: false),
                    LastSyncAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    LastSyncError = table.Column<string>(type: "TEXT", nullable: false),
                    UidValidity = table.Column<long>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmailAccounts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EmailMessages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    AccountId = table.Column<int>(type: "INTEGER", nullable: false),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Folder = table.Column<string>(type: "TEXT", nullable: false),
                    Uid = table.Column<long>(type: "INTEGER", nullable: false),
                    MessageId = table.Column<string>(type: "TEXT", nullable: false),
                    FromName = table.Column<string>(type: "TEXT", nullable: false),
                    FromAddress = table.Column<string>(type: "TEXT", nullable: false),
                    ToAddress = table.Column<string>(type: "TEXT", nullable: false),
                    Subject = table.Column<string>(type: "TEXT", nullable: false),
                    Snippet = table.Column<string>(type: "TEXT", nullable: false),
                    BodyText = table.Column<string>(type: "TEXT", nullable: false),
                    SentAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    IsRead = table.Column<bool>(type: "INTEGER", nullable: false),
                    HasAttachment = table.Column<bool>(type: "INTEGER", nullable: false),
                    SizeBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    FetchedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailMessages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmailMessages_EmailAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "EmailAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EmailMessages_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailAccounts_UserId",
                table: "EmailAccounts",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_AccountId_Folder_Uid",
                table: "EmailMessages",
                columns: new[] { "AccountId", "Folder", "Uid" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_UserId_SentAt",
                table: "EmailMessages",
                columns: new[] { "UserId", "SentAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailMessages");

            migrationBuilder.DropTable(
                name: "EmailAccounts");
        }
    }
}
