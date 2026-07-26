using System.Text.Json;
using AutoGrading.Common.Messaging;
using AutoGrading.Contracts.Events;
using AutoGrading.Grading.Api.Domain;
using AutoGrading.Grading.Api.Interfaces;
using AutoGrading.Common.Ai;

namespace AutoGrading.Grading.Api.Jobs;

/// <summary>
/// Hangfire background job: runs AI grading for a submission whose artifacts have been extracted,
/// fetching the real lecturer-defined rubric criteria from Catalog and the real extracted
/// report/diagram content from Submission before calling the LLM.
/// </summary>
public sealed class AiGradingJob(
    IGradingRepository repository,
    ICatalogApiClient catalogApiClient,
    ISubmissionApiClient submissionApiClient,
    IAiClient aiClient,
    AiOptions aiOptions,
    IEventBus eventBus)
{
    public async Task ExecuteAsync(Guid submissionId, string? assignmentDescriptionOverride = null, CancellationToken cancellationToken = default)
    {
        var run = new AiGradingRun
        {
            SubmissionId = submissionId,
            Model = aiOptions.Model,
            Status = AiGradingRunStatus.Running,
        };

        await repository.AddRunAsync(run, cancellationToken);

        try
        {
            var submission = await submissionApiClient.GetSubmissionAsync(submissionId, cancellationToken)
                ?? throw new InvalidOperationException($"Submission {submissionId} was not found.");

            await eventBus.PublishAsync(
                new SubmissionStatusChanged(submission.Id, submission.StudentId, "AiGrading"),
                cancellationToken);

            var rubricCriteria = await catalogApiClient.GetCriteriaForAssignmentAsync(submission.AssignmentId, cancellationToken);

            // Fall back to a single general criterion when no rubric has been uploaded yet
            // so grading produces a result rather than failing hard.
            var criteria = rubricCriteria.Count > 0
                ? rubricCriteria.Select(c => new GradingCriterionInput(c.Id, c.Name, c.MaxScore)).ToArray()
                : [new GradingCriterionInput(Guid.NewGuid(), "Overall Quality", 10m)];

            var assignment = await catalogApiClient.GetAssignmentAsync(submission.AssignmentId, cancellationToken);
            var assignmentDescription = assignmentDescriptionOverride ?? assignment?.Description;

            var reportArtifact = submission.Artifacts.FirstOrDefault(a => a.Kind == ArtifactKindDto.Report);

            var reportContent = reportArtifact?.Content ?? string.Empty;
            var images = ParseImages(reportArtifact?.ImagesJson).ToArray();

            var results = await aiClient.GradeAsync(
                reportContent: reportContent,
                diagramContent: string.Empty,
                criteria: criteria,
                assignmentDescription: assignmentDescription,
                images: images,
                cancellationToken: cancellationToken);

            var scores = results.Select(result => new AiCriterionScore
            {
                GradingRunId = run.Id,
                SubmissionId = submissionId,
                RubricCriterionId = result.RubricCriterionId,
                MaxScore = result.MaxScore,
                SuggestedScore = result.SuggestedScore,
                Deductions = result.Deductions,
                Evidence = result.Evidence,
                Comment = result.Comment,
                Confidence = result.Confidence,
            }).ToList();
            await repository.AddCriterionScoresAsync(run.Id, scores, cancellationToken);

            await repository.UpdateRunStatusAsync(run.Id, AiGradingRunStatus.Completed, DateTimeOffset.UtcNow, cancellationToken);

            var totalScore = results.Sum(r => r.SuggestedScore);
            await eventBus.PublishAsync(
                new AiGradingCompleted(submissionId, run.Id, totalScore),
                cancellationToken);

            await eventBus.PublishAsync(
                new SubmissionStatusChanged(submission.Id, submission.StudentId, "Completed"),
                cancellationToken);
        }
        catch (Exception ex)
        {
            await repository.UpdateRunStatusAsync(run.Id, AiGradingRunStatus.Failed, DateTimeOffset.UtcNow, cancellationToken);

            // We may not have StudentId if it failed before fetching submission.
            // Attempt to get it if possible, otherwise we can't notify the user effectively.
            // Since this is a background job, we'll just try to fetch it for the event if we don't have it.
            try
            {
                var submission = await submissionApiClient.GetSubmissionAsync(submissionId, cancellationToken);
                if (submission != null)
                {
                    await eventBus.PublishAsync(
                        new SubmissionStatusChanged(submission.Id, submission.StudentId, "AiGradingFailed", ex.Message),
                        cancellationToken);
                }
            } catch { /* ignore */ }

            throw;
        }
    }

    private static string[] ParseImages(string? imagesJson)
    {
        if (string.IsNullOrWhiteSpace(imagesJson))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(imagesJson) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
