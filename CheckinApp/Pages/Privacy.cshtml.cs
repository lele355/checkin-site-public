using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

[AllowAnonymous]
public class PrivacyModel : PageModel
{
    public void OnGet() { }
}
