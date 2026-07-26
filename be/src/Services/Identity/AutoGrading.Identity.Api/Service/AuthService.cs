using AutoGrading.Common.Auth;
using AutoGrading.Common.Messaging;
using AutoGrading.Contracts.Enums;
using AutoGrading.Contracts.Events;
using AutoGrading.Identity.Api.Auth;
using AutoGrading.Identity.Api.Domain;
using AutoGrading.Identity.Api.Interfaces;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace AutoGrading.Identity.Api.Service;

public sealed class AuthService(
    IUserRepository repository,
    IPasswordHasher<User> passwordHasher,
    JwtTokenGenerator tokenGenerator,
    IEventBus eventBus,
    IOptions<GoogleAuthOptions> googleOptions) : IAuthService
{
    public async Task<UserAuthResult> RegisterAsync(string email, string password, string fullName, AppRole role, string? studentCode, Guid? classId, CancellationToken ct)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();

        if (await repository.ExistsByEmailAsync(normalizedEmail, ct))
        {
            throw new UserAlreadyExistsException(normalizedEmail);
        }

        if (classId is { } id && !await repository.ClassExistsAsync(id, ct))
        {
            throw new ClassNotFoundException(id);
        }

        if (!string.IsNullOrWhiteSpace(studentCode) &&
            await repository.ExistsByStudentCodeAsync(studentCode.Trim().ToLowerInvariant(), null, ct))
        {
            throw new StudentCodeAlreadyAssignedException(studentCode.Trim());
        }

        var user = new User
        {
            Email = normalizedEmail,
            FullName = fullName,
            Role = role,
            StudentCode = studentCode,
            ClassId = classId,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, password);

        await repository.CreateUserAsync(user, ct);

        await eventBus.PublishAsync(new UserRegistered(user.Id, user.Email, user.FullName, user.Role), ct);

        return new UserAuthResult(user.Id, user.Email, user.Role.ToString().ToLowerInvariant());
    }

    public async Task<AuthTokenResult> LoginAsync(string email, string password, CancellationToken ct)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var user = await repository.GetByEmailAsync(normalizedEmail, ct);

        if (user is null || user.PasswordHash is null)
        {
            throw new InvalidCredentialsException();
        }

        var verification = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (verification == PasswordVerificationResult.Failed)
        {
            throw new InvalidCredentialsException();
        }

        var token = tokenGenerator.GenerateToken(user.Id, user.Email, user.Role);
        return new AuthTokenResult(token, user.Id, user.Email, user.Role.ToString().ToLowerInvariant());
    }

    public async Task<AuthTokenResult> GoogleLoginAsync(string idToken, CancellationToken ct)
    {
        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(idToken, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = [googleOptions.Value.ClientId],
            });
        }
        catch (InvalidJwtException)
        {
            throw new InvalidGoogleTokenException();
        }

        var email = payload.Email.Trim().ToLowerInvariant();
        if (!payload.EmailVerified || !EducationEmailValidator.IsEducationEmail(email))
        {
            throw new EducationEmailNotVerifiedException();
        }

        var user = await repository.GetByGoogleSubjectOrEmailAsync(payload.Subject, email, ct);

        if (user is null)
        {
            user = new User
            {
                Email = email,
                FullName = payload.Name ?? email,
                Role = AppRole.Student,
                GoogleSubjectId = payload.Subject,
            };
            await repository.CreateUserAsync(user, ct);

            await eventBus.PublishAsync(new UserRegistered(user.Id, user.Email, user.FullName, user.Role), ct);
        }
        else if (user.GoogleSubjectId is null)
        {
            await repository.LinkGoogleSubjectIdAsync(user.Id, payload.Subject, ct);
        }

        var token = tokenGenerator.GenerateToken(user.Id, user.Email, user.Role);
        return new AuthTokenResult(token, user.Id, user.Email, user.Role.ToString().ToLowerInvariant());
    }
}
