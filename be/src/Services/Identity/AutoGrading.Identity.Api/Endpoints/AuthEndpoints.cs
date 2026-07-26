using AutoGrading.Identity.Api.Dto;
using AutoGrading.Identity.Api.Interfaces;

namespace AutoGrading.Identity.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/auth").WithTags("Auth");

        group.MapPost("/register", RegisterAsync);
        group.MapPost("/login", LoginAsync);
        group.MapPost("/google", GoogleLoginAsync);

        return app;
    }

    private static async Task<IResult> RegisterAsync(RegisterRequest request, IAuthService service, CancellationToken cancellationToken)
    {
        try
        {
            var result = await service.RegisterAsync(request.Email, request.Password, request.FullName, request.Role, request.StudentCode, request.ClassId, cancellationToken);
            return Results.Created($"/auth/users/{result.UserId}", RegisterResponse.FromData(result));
        }
        catch (UserAlreadyExistsException ex)
        {
            return Results.Conflict(new { message = ex.Message });
        }
        catch (ClassNotFoundException ex)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
        catch (StudentCodeAlreadyAssignedException ex)
        {
            return Results.Conflict(new { message = ex.Message });
        }
    }

    private static async Task<IResult> LoginAsync(LoginRequest request, IAuthService service, CancellationToken cancellationToken)
    {
        try
        {
            var result = await service.LoginAsync(request.Email, request.Password, cancellationToken);
            return Results.Ok(LoginResponse.FromData(result));
        }
        catch (InvalidCredentialsException)
        {
            return Results.Unauthorized();
        }
    }

    private static async Task<IResult> GoogleLoginAsync(GoogleLoginRequest request, IAuthService service, CancellationToken cancellationToken)
    {
        try
        {
            var result = await service.GoogleLoginAsync(request.IdToken, cancellationToken);
            return Results.Ok(LoginResponse.FromData(result));
        }
        catch (InvalidGoogleTokenException)
        {
            return Results.Unauthorized();
        }
        catch (EducationEmailNotVerifiedException)
        {
            return Results.Forbid();
        }
    }
}
