using AutoGrading.Common.Messaging;
using AutoGrading.Common.Storage;
using AutoGrading.Contracts.Events;
using AutoGrading.SubmissionSvc.Api.Constant;
using AutoGrading.SubmissionSvc.Api.Domain;
using AutoGrading.SubmissionSvc.Api.Interfaces;
using AutoGrading.SubmissionSvc.Api.Jobs;
using Hangfire;

namespace AutoGrading.SubmissionSvc.Api.Service;

public sealed class SubmissionService(
    ISubmissionRepository repository,
    ICatalogApiClient catalog,
    IObjectStorage storage,
    IEventBus eventBus,
    IBackgroundJobClient backgroundJobs) : ISubmissionService
{
    public async Task<IReadOnlyList<Submission>> ListForRequesterAsync(SubmissionListQuery query, RequesterContext requester, CancellationToken ct)
    {
        var assignmentId = query.AssignmentId;
        var studentId = query.StudentId;
        IReadOnlyCollection<Guid>? restrictToStudentIds = null;

        if (requester.IsStudent)
        {
            studentId = requester.UserId;
        }
        else if (requester.IsLecturer)
        {
            if (assignmentId is null) throw new SubmissionValidationException(SubmissionConstants.AssignmentIdRequiredForLecturerListing);
            restrictToStudentIds = await GetLecturerAllowedStudentIdsAsync(requester.UserId, assignmentId.Value, ct);
        }

        return await repository.ListAsync(assignmentId, restrictToStudentIds, studentId, ct);
    }

    public async Task<Submission> GetForRequesterAsync(Guid id, RequesterContext requester, CancellationToken ct)
    {
        var submission = await repository.GetByIdAsync(id, includeArtifacts: true, ct);
        if (submission is null) throw new SubmissionNotFoundException(id);

        await EnsureCanActOnAsync(submission, requester, ct);

        return submission;
    }

    public async Task<Submission> UploadAsync(UploadSubmissionCommand command, RequesterContext requester, CancellationToken ct)
    {
        var assignment = await catalog.GetAssignmentAsync(command.AssignmentId, ct);
        if (assignment is null) throw new SubmissionAssignmentNotFoundException();

        Guid studentId;
        if (requester.IsStudent) studentId = requester.UserId!.Value;
        else if (command.StudentId is Guid requestedStudentId) studentId = requestedStudentId;
        else throw new SubmissionValidationException(SubmissionConstants.StudentIdRequiredForLecturerUpload);

        // Attempt-limit/attempt-conflict exceptions from Phase 2 propagate unchanged to the endpoint.
        var submission = await repository.CreateWithAttemptCheckAsync(command.AssignmentId, studentId, assignment.MaxAttempts, ct);

        var reportKey = $"submissions/{Guid.NewGuid()}-{command.ReportFileName}";
        try
        {
            await storage.UploadAsync(reportKey, command.ReportStream, command.ReportContentType, ct);

            await repository.SaveUploadResultAsync(submission, reportKey, null, ct);
        }
        catch
        {
            await repository.DeleteAsync(submission, CancellationToken.None);
            try { await storage.DeleteAsync(reportKey, CancellationToken.None); } catch { }
            throw;
        }

        await eventBus.PublishAsync(
            new SubmissionUploaded(submission.Id, submission.AssignmentId, submission.StudentId, reportKey, null),
            ct);

        await eventBus.PublishAsync(
            new SubmissionStatusChanged(submission.Id, submission.StudentId, "Uploaded"),
            ct);

        return submission;
    }

    public async Task RetryAsync(Guid id, RequesterContext requester, CancellationToken ct)
    {
        var submission = await repository.GetByIdAsync(id, includeArtifacts: false, ct);
        if (submission is null) throw new SubmissionNotFoundException(id);

        await EnsureCanActOnAsync(submission, requester, ct);

        await repository.ResetForRetryAsync(id, ct);

        // Pre-existing behavior, preserved as-is: retry has no de-duplication, calling it twice
        // enqueues ExtractionJob twice. Out of scope for this behavior-preserving refactor.
        backgroundJobs.Enqueue<ExtractionJob>(j => j.ExecuteAsync(id, CancellationToken.None));
    }

    private async Task EnsureCanActOnAsync(Submission submission, RequesterContext requester, CancellationToken ct)
    {
        if (requester.IsStudent && submission.StudentId != requester.UserId) throw new SubmissionForbiddenException();

        if (requester.IsLecturer)
        {
            var allowedStudentIds = await GetLecturerAllowedStudentIdsAsync(requester.UserId, submission.AssignmentId, ct);
            if (!allowedStudentIds.Contains(submission.StudentId)) throw new SubmissionForbiddenException();
        }
    }

    /// <summary>Student ids a lecturer may act on for the given assignment — the union of every
    /// class they teach for that assignment's subject. Empty if the lecturer teaches no class
    /// there (or their own id failed to resolve), which correctly hides all submissions rather
    /// than falling back to "show everyone".</summary>
    private async Task<HashSet<Guid>> GetLecturerAllowedStudentIdsAsync(Guid? lecturerId, Guid assignmentId, CancellationToken ct)
    {
        if (lecturerId is null) return [];
        var assignment = await catalog.GetAssignmentAsync(assignmentId, ct);
        if (assignment is null) return [];
        return await catalog.GetLecturerStudentIdsAsync(lecturerId.Value, assignment.SubjectId, ct);
    }
}
