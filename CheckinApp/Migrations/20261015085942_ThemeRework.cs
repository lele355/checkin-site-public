using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CheckinApp.Migrations
{
    /// <inheritdoc />
    public partial class ThemeRework : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "ThemeMode",
                table: "Users",
                newName: "Theme");

            migrationBuilder.RenameColumn(
                name: "AccentTheme",
                table: "Users",
                newName: "Accent");

            // 旧值（light/dark + teal/blue/purple/pink）语义已变，清洗成新主题体系
            migrationBuilder.Sql("UPDATE Users SET Theme = 'editorial', Accent = '' WHERE Theme NOT IN ('editorial','neumorphism','natural','macos','clay');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Theme",
                table: "Users",
                newName: "ThemeMode");

            migrationBuilder.RenameColumn(
                name: "Accent",
                table: "Users",
                newName: "AccentTheme");
        }
    }
}
