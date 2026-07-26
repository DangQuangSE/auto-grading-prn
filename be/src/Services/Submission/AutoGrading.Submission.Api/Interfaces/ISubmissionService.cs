using AutoGrading.SubmissionSvc.Api.Domain;

namespace AutoGrading.SubmissionSvc.Api.Interfaces;

/// <summary>Auth-framework-free view of the caller, built by the endpoint from <c>ClaimsPrincipal</c>
/// before calling into <c>Service/</c> — keeps the service free of ASP.NET Core auth types.</summary>
public sealed record RequesterContext(Guid? UserId, bool IsStudent, bool IsLecturer, bool IsAdmin);

public sealed record SubmissionListQuery(Guid? AssignmentId, Guid? StudentId);

/// <summary>Streams are opened and disposed by the endpoint (matching current <c>await using</c> usage);
/// <c>Service/</c> only reads from them, never disposes.</summary>
public sealed record UploadSubmissionCommand(
    Guid AssignmentId,
    Guid? StudentId,
    Stream ReportStream,
    string ReportFileName,
    string ReportContentType);

public interface ISubmissionService
{
    Task<IReadOnlyList<Submission>> ListForRequesterAsync(SubmissionListQuery query, RequesterContext requester, CancellationToken ct);

    Task<Submission> GetForRequesterAsync(Guid id, RequesterContext requester, CancellationToken ct);

    Task<Submission> UploadAsync(UploadSubmissionCommand command, RequesterContext requester, CancellationToken ct);

    Task RetryAsync(Guid id, RequesterContext requester, CancellationToken ct);
}

public sealed class SubmissionNotFoundException(Guid id) : Exception($"Submission '{id}' was not found.")
{
    public Guid Id { get; } = id;
}

public sealed class SubmissionForbiddenException() : Exception("Requester is not authorized to access this submission.");

/// <summary>Signals a caller-input error that should map to 400 Bad Request at the endpoint.</summary>
public sealed class SubmissionValidationException(string message) : Exception(message);

/// <summary>Distinct from <see cref="SubmissionNotFoundException"/> because the upload endpoint's
/// "assignment not found" response carries an error body, while the submission-not-found responses
/// on GET/retry return an empty 404 — the two must not be conflated into one exception type.</summary>
public sealed class SubmissionAssignmentNotFoundException() : Exception(Constant.SubmissionConstants.AssignmentNotFound);
