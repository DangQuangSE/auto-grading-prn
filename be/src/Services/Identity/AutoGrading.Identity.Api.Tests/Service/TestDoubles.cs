using AutoGrading.Common.Messaging;
using AutoGrading.Contracts.Events;
using AutoGrading.Identity.Api.Domain;
using Microsoft.AspNetCore.Identity;

namespace AutoGrading.Identity.Api.Tests.Service;

public sealed class FakeEventBus : IEventBus
{
    public readonly List<IntegrationEvent> Published = [];

    public Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default) where TEvent : IntegrationEvent
    {
        Published.Add(@event);
        return Task.CompletedTask;
    }

    public void Subscribe<TEvent, THandler>()
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
    }
}

/// <summary>Trivial reversible "hash" (prefixes the plaintext) so tests can drive both
/// success and failure verification paths without pulling in real ASP.NET Identity hashing.</summary>
public sealed class FakePasswordHasher : IPasswordHasher<User>
{
    public string HashPassword(User user, string password) => $"hashed:{password}";

    public PasswordVerificationResult VerifyHashedPassword(User user, string hashedPassword, string providedPassword) =>
        hashedPassword == $"hashed:{providedPassword}"
            ? PasswordVerificationResult.Success
            : PasswordVerificationResult.Failed;
}
