using AutoGrading.Common.Auth;
using AutoGrading.Contracts.Enums;
using AutoGrading.Identity.Api.Auth;
using AutoGrading.Identity.Api.Interfaces;
using AutoGrading.Identity.Api.Service;
using Microsoft.Extensions.Options;

namespace AutoGrading.Identity.Api.Tests.Service;

public class AuthServiceTests
{
    private static AuthService CreateService(FakeUserRepository repo, FakeEventBus? eventBus = null) =>
        new(
            repo,
            new FakePasswordHasher(),
            new JwtTokenGenerator(Options.Create(new JwtOptions { SigningKey = "unit-test-signing-key-unit-test-signing-key", Issuer = "test", Audience = "test" })),
            eventBus ?? new FakeEventBus(),
            Options.Create(new GoogleAuthOptions { ClientId = "test-client-id" }));

    [Fact]
    public async Task RegisterAsync_NewEmail_CreatesUserAndPublishesEvent()
    {
        var repo = new FakeUserRepository();
        var eventBus = new FakeEventBus();
        var service = CreateService(repo, eventBus);

        var result = await service.RegisterAsync("Student@Example.com", "P@ssw0rd", "Alice", AppRole.Student, "SC1", null, CancellationToken.None);

        Assert.Equal("student@example.com", result.Email);
        Assert.Single(repo.Users);
        Assert.Equal("hashed:P@ssw0rd", repo.Users[0].PasswordHash);
        Assert.Single(eventBus.Published);
    }

    [Fact]
    public async Task RegisterAsync_ExistingEmail_ThrowsUserAlreadyExists()
    {
        var repo = new FakeUserRepository();
        repo.Users.Add(new AutoGrading.Identity.Api.Domain.User { Email = "student@example.com" });
        var service = CreateService(repo);

        await Assert.ThrowsAsync<UserAlreadyExistsException>(() =>
            service.RegisterAsync("student@example.com", "pw", "Alice", AppRole.Student, null, null, CancellationToken.None));
    }

    [Fact]
    public async Task RegisterAsync_UnknownClassId_ThrowsClassNotFound()
    {
        var repo = new FakeUserRepository();
        var service = CreateService(repo);
        var unknownClassId = Guid.NewGuid();

        await Assert.ThrowsAsync<ClassNotFoundException>(() =>
            service.RegisterAsync("student@example.com", "pw", "Alice", AppRole.Student, null, unknownClassId, CancellationToken.None));
    }

    [Fact]
    public async Task LoginAsync_CorrectPassword_ReturnsToken()
    {
        var repo = new FakeUserRepository();
        var service = CreateService(repo);
        await service.RegisterAsync("student@example.com", "P@ssw0rd", "Alice", AppRole.Student, null, null, CancellationToken.None);

        var result = await service.LoginAsync("Student@Example.com", "P@ssw0rd", CancellationToken.None);

        Assert.False(string.IsNullOrWhiteSpace(result.Token));
        Assert.Equal("student@example.com", result.Email);
        Assert.Equal("student", result.Role);
    }

    [Fact]
    public async Task LoginAsync_UnknownEmail_ThrowsInvalidCredentials()
    {
        var repo = new FakeUserRepository();
        var service = CreateService(repo);

        await Assert.ThrowsAsync<InvalidCredentialsException>(() =>
            service.LoginAsync("nobody@example.com", "pw", CancellationToken.None));
    }

    [Fact]
    public async Task LoginAsync_WrongPassword_ThrowsInvalidCredentials()
    {
        var repo = new FakeUserRepository();
        var service = CreateService(repo);
        await service.RegisterAsync("student@example.com", "P@ssw0rd", "Alice", AppRole.Student, null, null, CancellationToken.None);

        await Assert.ThrowsAsync<InvalidCredentialsException>(() =>
            service.LoginAsync("student@example.com", "WrongPassword", CancellationToken.None));
    }

    [Fact]
    public async Task LoginAsync_GoogleOnlyAccountWithNoPasswordHash_ThrowsInvalidCredentials()
    {
        var repo = new FakeUserRepository();
        repo.Users.Add(new AutoGrading.Identity.Api.Domain.User { Email = "google@example.com", PasswordHash = null });
        var service = CreateService(repo);

        await Assert.ThrowsAsync<InvalidCredentialsException>(() =>
            service.LoginAsync("google@example.com", "anything", CancellationToken.None));
    }
}
