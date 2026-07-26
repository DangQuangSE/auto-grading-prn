using AutoGrading.Catalog.Api.Domain;
using AutoGrading.Catalog.Api.Interfaces;
using AutoGrading.Common.Messaging;
using AutoGrading.Common.Ai;
using AutoGrading.Common.Storage;
using AutoGrading.Contracts.Events;

namespace AutoGrading.Catalog.Api.Jobs;

/// <summary>
/// Hangfire background job: downloads a rubric's uploaded .docx, extracts its text, calls the AI
/// extraction client to derive draft criteria, and transitions the rubric from Parsing to Draft.
/// </summary>
public sealed class RubricParsingJob(
    IRubricRepository repo,
    IObjectStorage storage,
    IAiClient aiClient,
    IEventBus eventBus,
    ILogger<RubricParsingJob> logger)
{
    public async Task ExecuteAsync(Guid rubricId, CancellationToken cancellationToken = default)
    {
        var rubric = await repo.GetByIdAsync(rubricId, includeCriteria: true, cancellationToken);
        if (rubric is null)
        {
            logger.LogWarning("RubricParsingJob: rubric {RubricId} no longer exists; skipping.", rubricId);
            return;
        }

        if (rubric.Status != RubricStatus.Parsing)
        {
            logger.LogInformation(
                "RubricParsingJob: rubric {RubricId} is already {Status}; superseded by a later upload/retry, skipping.",
                rubricId,
                rubric.Status);
            return;
        }

        if (string.IsNullOrEmpty(rubric.FileObjectKey))
        {
            logger.LogError("RubricParsingJob: rubric {RubricId} has no file to parse.", rubricId);
            throw new InvalidOperationException($"Rubric {rubricId} has no uploaded file to parse.");
        }

        try
        {
            string documentText;
            await using (var fileStream = await storage.DownloadAsync(rubric.FileObjectKey, cancellationToken))
            {
                documentText = DocxTextExtractor.ExtractText(fileStream);
            }

            var extractedCriteria = await aiClient.ParseRubricCriteriaAsync(documentText, cancellationToken);

            var criteria = extractedCriteria.Select(criterion => new RubricCriterion
            {
                RubricId = rubric.Id,
                Name = criterion.Name,
                Description = criterion.Description,
                MaxScore = criterion.MaxScore,
                OrderIndex = criterion.Order,
            }).ToList();

            // Setting Status before the repository call means the single SaveChangesAsync inside
            // UpdateCriteriaAsync commits the criteria replacement AND the status transition together,
            // matching the original job's one-round-trip SaveChanges call exactly.
            rubric.Status = RubricStatus.Draft;
            var newCriteria = await repo.UpdateCriteriaAsync(rubric, criteria, cancellationToken);

            await eventBus.PublishAsync(
                new RubricParsed(rubric.Id, rubric.SubjectId, rubric.AssignmentId, newCriteria.Count),
                cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "RubricParsingJob: failed to parse rubric {RubricId}; it remains in Parsing for Hangfire retry.", rubricId);
            throw;
        }
    }
}
