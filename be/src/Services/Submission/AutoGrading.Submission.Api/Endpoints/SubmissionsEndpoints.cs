using AutoGrading.SubmissionSvc.Api.Dto;
using AutoGrading.SubmissionSvc.Api.Interfaces;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace AutoGrading.SubmissionSvc.Api.Endpoints;

public static class SubmissionsEndpoints
{
    public static IEndpointRouteBuilder MapSubmissionsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/submissions").WithTags("Submissions");

        group.MapGet("/", async (Guid? assignmentId, Guid? studentId, ClaimsPrincipal user, ISubmissionService service, CancellationToken ct) =>
            {
                if (!TryBuildRequesterContext(user, out var requester, out var forbid)) return forbid!;

                try
                {
                    var submissions = await service.ListForRequesterAsync(new SubmissionListQuery(assignmentId, studentId), requester, ct);
                    return Results.Ok(submissions.Select(SubmissionResponse.FromDomain));
                }
                catch (SubmissionValidationException ex)
                {
                    return Results.BadRequest(new { error = ex.Message });
                }
            })
            .RequireAuthorization(policy => policy.RequireRole("student", "lecturer", "admin"));

        group.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, ISubmissionService service, CancellationToken ct) =>
            {
                if (!TryBuildRequesterContext(user, out var requester, out var forbid)) return forbid!;

                try
                {
                    var submission = await service.GetForRequesterAsync(id, requester, ct);
                    return Results.Ok(SubmissionResponse.FromDomain(submission));
                }
                catch (SubmissionNotFoundException)
                {
                    return Results.NotFound();
                }
                catch (SubmissionForbiddenException)
                {
                    return Results.Forbid();
                }
            })
            .RequireAuthorization(policy => policy.RequireRole("student", "lecturer", "admin", "service"));

        group.MapPost("/upload", UploadSubmissionAsync)
            .RequireAuthorization(policy => policy.RequireRole("student", "lecturer", "admin"))
            .DisableAntiforgery();

        group.MapPost("/{id:guid}/retry", async (Guid id, ClaimsPrincipal user, ISubmissionService service, CancellationToken ct) =>
            {
                if (!TryBuildRequesterContext(user, out var requester, out var forbid)) return forbid!;

                try
                {
                    await service.RetryAsync(id, requester, ct);
                    return Results.Accepted();
                }
                catch (SubmissionNotFoundException)
                {
                    return Results.NotFound();
                }
                catch (SubmissionForbiddenException)
                {
                    return Results.Forbid();
                }
            })
            .RequireAuthorization(policy => policy.RequireRole("student", "lecturer", "admin"));

        return app;
    }

    /// <summary>Builds the auth-framework-free <see cref="RequesterContext"/> for the service layer.
    /// A student whose <c>NameIdentifier</c> claim is missing/not a Guid is rejected here with
    /// <c>Forbid()</c> before the service is ever called — same behavior as the previous inline
    /// <c>Guid.TryParse(...) → Forbid</c> checks, just relocated ahead of the service call.</summary>
    private static bool TryBuildRequesterContext(ClaimsPrincipal user, out RequesterContext requester, out IResult? forbidResult)
    {
        var isStudent = user.IsInRole("student");
        var isLecturer = user.IsInRole("lecturer");
        var isAdmin = user.IsInRole("admin");
        Guid? userId = Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed) ? parsed : null;

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

    private static async Task<IResult> UploadSubmissionAsync(
        [FromForm] UploadSubmissionForm form,
        ClaimsPrincipal user,
        ISubmissionService service,
        CancellationToken cancellationToken)
    {
        if (!TryBuildRequesterContext(user, out var requester, out var forbid)) return forbid!;

        await using var reportStream = form.ReportFile.OpenReadStream();

        var command = new UploadSubmissionCommand(
            form.AssignmentId,
            form.StudentId,
            reportStream,
            form.ReportFile.FileName,
            form.ReportFile.ContentType);

        try
        {
            var submission = await service.UploadAsync(command, requester, cancellationToken);
            return Results.Created($"/submissions/{submission.Id}", SubmissionResponse.FromDomain(submission));
        }
        catch (SubmissionAssignmentNotFoundException ex)
        {
            return Results.NotFound(new { error = ex.Message });
        }
        catch (SubmissionValidationException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
        catch (SubmissionAttemptLimitReachedException ex)
        {
            return Results.Conflict(new { error = ex.Message, usedAttempts = ex.Used, maxAttempts = ex.Max });
        }
        catch (SubmissionAttemptConflictException ex)
        {
            return Results.Conflict(new { error = ex.Message, usedAttempts = ex.Used, maxAttempts = ex.Max });
        }
    }
}
