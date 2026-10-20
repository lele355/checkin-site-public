using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

[AllowAnonymous]
public class TermsModel : PageModel
{
    public void OnGet() { }
}
