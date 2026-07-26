namespace AutoGrading.Contracts.Events;

/// <summary>Published by Submission Service after report file is stored in MinIO.</summary>
public sealed record SubmissionUploaded(
    Guid SubmissionId,
    Guid AssignmentId,
    Guid StudentId,
    string ReportObjectKey,
    string? DiagramObjectKey
) : IntegrationEvent;
