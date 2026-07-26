namespace AutoGrading.Contracts.Events;

/// <summary>Published by Grading Service's AI-grading job once AI scoring finishes.</summary>
public sealed record AiGradingCompleted(Guid SubmissionId, Guid AiGradingRunId, decimal TotalSuggestedScore) : IntegrationEvent;
