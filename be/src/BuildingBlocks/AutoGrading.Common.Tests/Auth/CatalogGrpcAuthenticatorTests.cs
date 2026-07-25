using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using AutoGrading.Common.Auth;
using Grpc.Core;
using Microsoft.Extensions.Options;

namespace AutoGrading.Common.Tests.Auth;

public class CatalogGrpcAuthenticatorTests
{
    private static JwtTokenGenerator CreateTokenGenerator() =>
        new(Options.Create(new JwtOptions { SigningKey = "unit-test-signing-key-min-32-characters!!" }));

    [Fact]
    public async Task AttachServiceToken_AddsBearerAuthorizationMetadata()
    {
        var metadata = new Metadata();

        await CatalogGrpcAuthenticator.AttachServiceToken(CreateTokenGenerator(), "grading", metadata);

        var entry = Assert.Single(metadata, e => string.Equals(e.Key, "authorization", StringComparison.OrdinalIgnoreCase));
        Assert.StartsWith("Bearer ", entry.Value);
    }

    [Fact]
    public async Task AttachServiceToken_MintsAValidServiceRoleJwt()
    {
        var metadata = new Metadata();

        await CatalogGrpcAuthenticator.AttachServiceToken(CreateTokenGenerator(), "grading", metadata);

        var entry = metadata.Single(e => string.Equals(e.Key, "authorization", StringComparison.OrdinalIgnoreCase));
        var token = entry.Value["Bearer ".Length..];
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal("service", jwt.Claims.Single(c => c.Type == ClaimTypes.Role).Value);
    }

    [Theory]
    [InlineData("grading")]
    [InlineData("submission")]
    public async Task AttachServiceToken_EmbedsCallingServiceNameInTokenSubjectEmail(string callingServiceName)
    {
        var metadata = new Metadata();

        await CatalogGrpcAuthenticator.AttachServiceToken(CreateTokenGenerator(), callingServiceName, metadata);

        var entry = metadata.Single(e => string.Equals(e.Key, "authorization", StringComparison.OrdinalIgnoreCase));
        var token = entry.Value["Bearer ".Length..];
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal($"{callingServiceName}@internal.autograding", jwt.Claims.Single(c => c.Type == JwtRegisteredClaimNames.Email).Value);
    }
}
