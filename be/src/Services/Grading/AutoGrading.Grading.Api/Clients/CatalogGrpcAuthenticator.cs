using AutoGrading.Common.Auth;
using Grpc.Core;

namespace AutoGrading.Grading.Api.Clients;

public static class CatalogGrpcAuthenticator
{
    /// <summary>Mints a short-lived service JWT and attaches it as a Bearer token to outgoing gRPC call metadata, mirroring <see cref="ServiceAuthHandler"/>'s HTTP behavior for the gRPC transport.</summary>
    public static Task AttachServiceToken(JwtTokenGenerator tokenGenerator, Metadata metadata)
    {
        var token = tokenGenerator.GenerateServiceToken("grading");
        metadata.Add("Authorization", $"Bearer {token}");
        return Task.CompletedTask;
    }
}
