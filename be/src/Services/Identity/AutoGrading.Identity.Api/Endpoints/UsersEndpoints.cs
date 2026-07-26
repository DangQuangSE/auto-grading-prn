using System.Security.Claims;
using AutoGrading.Identity.Api.Constant;
using AutoGrading.Identity.Api.Dto;
using AutoGrading.Identity.Api.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AutoGrading.Identity.Api.Endpoints;

public static class UsersEndpoints
{
    public static IEndpointRouteBuilder MapUsersEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/users").WithTags("Users");

        group.MapGet("/", async (string[]? ids, ClaimsPrincipal caller, IUserService service, CancellationToken ct) =>
            {
                if (!TryBuildRequesterContext(caller, out var requester, out var forbid)) return forbid!;

                var requestedIds = ParseIds(ids);
                var users = await service.ListAsync(requestedIds, requester, ct);
                return Results.Ok(users.Select(UserSummary.FromData));
            })
            .RequireAuthorization(policy => policy.RequireRole("lecturer", "admin"));

        group.MapPatch("/{userId:guid}", UpdateUserAsync)
            .RequireAuthorization(policy => policy.RequireRole("lecturer", "admin"));

        group.MapPost("/bulk-import", BulkImportAsync)
            .RequireAuthorization(policy => policy.RequireRole("lecturer", "admin"))
            .DisableAntiforgery();

        return app;
    }

    /// <summary>Builds the auth-framework-free <see cref="RequesterContext"/> for the service layer.
    /// A student whose <c>NameIdentifier</c> claim is missing/not a Guid is rejected here with
    /// <c>Forbid()</c> before the service is ever called.</summary>
    private static bool TryBuildRequesterContext(ClaimsPrincipal caller, out RequesterContext requester, out IResult? forbidResult)
    {
        var isStudent = caller.IsInRole("student");
        var isLecturer = caller.IsInRole("lecturer");
        var isAdmin = caller.IsInRole("admin");
        Guid? userId = Guid.TryParse(caller.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed) ? parsed : null;

        if (isStudent && userId is null)
        {
            requester = null!;
            forbidResult = Results.Forbid();
            return false;
        }

        requester = new RequesterContext(userId, isStudent, isLecturer, isAdmin);
        forbidResult = null;
        return true;
    }

    private static async Task<IResult> UpdateUserAsync(
        Guid userId, UpdateUserRequest request, ClaimsPrincipal caller, IUserService service, CancellationToken cancellationToken)
    {
        if (!TryBuildRequesterContext(caller, out var requester, out var forbid)) return forbid!;

        try
        {
            var summary = await service.UpdateAsync(userId, request.StudentCode, request.ClassId, requester, cancellationToken);
            return Results.Ok(UserSummary.FromData(summary));
        }
        catch (UserNotFoundException)
        {
            return Results.NotFound();
        }
        catch (RosterAuthorizationException)
        {
            return Results.Forbid();
        }
        catch (ClassNotFoundException ex)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
        catch (StudentCodeAlreadyAssignedException ex)
        {
            return Results.Conflict(new { message = ex.Message });
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.Conflict(new { message = string.Format(IdentityConstants.ConcurrentModificationError, userId) });
        }
    }

    /// <summary>Bulk-updates StudentCode/ClassId from an uploaded roster file (.xlsx/.xls/.csv) with
    /// header-mapped columns Email, StudentCode, ClassName (case-insensitive; StudentCode may be blank
    /// to leave it unchanged). Each row is authorized independently — a lecturer can only update rows
    /// for students they have a relationship with. All accepted rows are persisted in a single
    /// SaveChangesAsync call; if that fails, no row is updated. Processes the file synchronously on the
    /// request thread; sized for class-scale rosters (~20-50 rows), not bulk imports — if usage regularly
    /// exceeds a few hundred rows, move this to a background job instead.</summary>
    private static async Task<IResult> BulkImportAsync(
        [FromForm] BulkImportForm form, ClaimsPrincipal caller, IUserService service, CancellationToken cancellationToken)
    {
        if (!TryBuildRequesterContext(caller, out var requester, out var forbid)) return forbid!;

        try
        {
            await using var stream = form.File.OpenReadStream();
            var result = await service.BulkImportAsync(stream, form.File.FileName, requester, cancellationToken);
            return Results.Ok(RosterImportReport.FromData(result));
        }
        catch (RosterFileParseException ex)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException)
        {
            return Results.Problem(
                "Failed to save roster import; no rows were updated. Please retry.",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static HashSet<Guid>? ParseIds(string[]? ids)
    {
        if (ids is not { Length: > 0 })
        {
            return null;
        }

        var parsed = ids
            .SelectMany(value => value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(token => Guid.TryParse(token, out _))
            .Select(Guid.Parse)
            .ToHashSet();

        return parsed.Count > 0 ? parsed : null;
    }
}
