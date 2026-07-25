using System.Security.Claims;
using AutoGrading.Common.Auth;

namespace AutoGrading.Common.Tests.Auth;

public class ClaimsPrincipalExtensionsTests
{
    [Fact]
    public void GetUserId_WithNameIdentifierClaim_ReturnsParsedGuid()
    {
        var userId = Guid.NewGuid();
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())]);
        var principal = new ClaimsPrincipal(identity);

        Assert.Equal(userId, principal.GetUserId());
    }

    [Fact]
    public void GetUserId_MissingClaim_ThrowsArgumentNullException()
    {
        // FindFirstValue returns null when the claim is absent, and the null-forgiving `!` in
        // GetUserId then hands that null straight to Guid.Parse, which throws ArgumentNullException.
        var principal = new ClaimsPrincipal(new ClaimsIdentity());

        Assert.Throws<ArgumentNullException>(() => principal.GetUserId());
    }

    [Fact]
    public void GetUserId_NonGuidClaimValue_ThrowsFormatException()
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "not-a-guid")]);
        var principal = new ClaimsPrincipal(identity);

        Assert.Throws<FormatException>(() => principal.GetUserId());
    }
}
