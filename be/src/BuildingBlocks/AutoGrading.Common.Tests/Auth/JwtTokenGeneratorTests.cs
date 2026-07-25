using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using AutoGrading.Common.Auth;
using AutoGrading.Contracts.Enums;
using Microsoft.Extensions.Options;

namespace AutoGrading.Common.Tests.Auth;

public class JwtTokenGeneratorTests
{
    private static JwtTokenGenerator CreateGenerator(JwtOptions? options = null) =>
        new(Options.Create(options ?? new JwtOptions
        {
            SigningKey = "unit-test-signing-key-unit-test-signing-key",
            Issuer = "AutoGrading.Test",
            Audience = "AutoGrading.Test.Audience",
            ExpiryMinutes = 30,
        }));

    [Fact]
    public void GenerateToken_IncludesExpectedClaims()
    {
        var generator = CreateGenerator();
        var userId = Guid.NewGuid();

        var token = generator.GenerateToken(userId, "user@example.com", AppRole.Lecturer);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal(userId.ToString(), jwt.Claims.Single(c => c.Type == JwtRegisteredClaimNames.Sub).Value);
        Assert.Equal("user@example.com", jwt.Claims.Single(c => c.Type == JwtRegisteredClaimNames.Email).Value);
        Assert.Equal(userId.ToString(), jwt.Claims.Single(c => c.Type == ClaimTypes.NameIdentifier).Value);
        Assert.Equal("lecturer", jwt.Claims.Single(c => c.Type == ClaimTypes.Role).Value);
    }

    [Fact]
    public void GenerateToken_UsesConfiguredIssuerAndAudience()
    {
        var generator = CreateGenerator();

        var token = generator.GenerateToken(Guid.NewGuid(), "user@example.com", AppRole.Student);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("AutoGrading.Test", jwt.Issuer);
        Assert.Equal("AutoGrading.Test.Audience", jwt.Audiences.Single());
    }

    [Fact]
    public void GenerateToken_CalledTwice_ProducesDifferentTokens()
    {
        var generator = CreateGenerator();
        var userId = Guid.NewGuid();

        var first = generator.GenerateToken(userId, "user@example.com", AppRole.Student);
        var second = generator.GenerateToken(userId, "user@example.com", AppRole.Student);

        // Distinct jti claims per call means the raw tokens differ even for identical inputs.
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void GenerateServiceToken_UsesServiceRoleAndInternalEmail()
    {
        var generator = CreateGenerator();

        var token = generator.GenerateServiceToken("grading-svc");

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("service", jwt.Claims.Single(c => c.Type == ClaimTypes.Role).Value);
        Assert.Equal("grading-svc@internal.autograding", jwt.Claims.Single(c => c.Type == JwtRegisteredClaimNames.Email).Value);
        Assert.Equal(Guid.Empty.ToString(), jwt.Claims.Single(c => c.Type == JwtRegisteredClaimNames.Sub).Value);
    }
}
