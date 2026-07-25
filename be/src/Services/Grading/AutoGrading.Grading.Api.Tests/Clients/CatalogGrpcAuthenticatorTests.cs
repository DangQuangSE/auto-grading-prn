using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using AutoGrading.Common.Auth;
using AutoGrading.Grading.Api.Clients;
using Grpc.Core;
using Microsoft.Extensions.Options;

namespace AutoGrading.Grading.Api.Tests.Clients;

public class CatalogGrpcAuthenticatorTests
{
    private static JwtTokenGenerator CreateTokenGenerator() =>
        new(Options.Create(new JwtOptions { SigningKey = "unit-test-signing-key-min-32-characters!!" }));

    [Fact]
    public async Task AttachServiceToken_AddsBearerAuthorizationMetadata()
    {
        var metadata = new Metadata();

        await CatalogGrpcAuthenticator.AttachServiceToken(CreateTokenGenerator(), metadata);

        var entry = Assert.Single(metadata, e => string.Equals(e.Key, "authorization", StringComparison.OrdinalIgnoreCase));
        Assert.StartsWith("Bearer ", entry.Value);
    }

    [Fact]
    public async Task AttachServiceToken_MintsAValidServiceRoleJwt()
    {
        var metadata = new Metadata();

        await CatalogGrpcAuthenticator.AttachServiceToken(CreateTokenGenerator(), metadata);

        var entry = metadata.Single(e => string.Equals(e.Key, "authorization", StringComparison.OrdinalIgnoreCase));
        var token = entry.Value["Bearer ".Length..];
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal("service", jwt.Claims.Single(c => c.Type == ClaimTypes.Role).Value);
    }
}
