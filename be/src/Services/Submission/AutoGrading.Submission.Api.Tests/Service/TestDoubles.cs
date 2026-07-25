using AutoGrading.Common.Messaging;
using AutoGrading.Common.Storage;
using AutoGrading.Contracts.Events;
using AutoGrading.SubmissionSvc.Api.Interfaces;
using Hangfire;
using Hangfire.Common;
using Hangfire.States;

namespace AutoGrading.Submission.Api.Tests.Service;

public sealed class FakeCatalogApiClient : ICatalogApiClient
{
    public AssignmentDto? Assignment;
    public HashSet<Guid> LecturerStudentIds = [];

    public Task<AssignmentDto?> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken) =>
        Task.FromResult(Assignment);

    public Task<HashSet<Guid>> GetLecturerStudentIdsAsync(Guid lecturerId, Guid subjectId, CancellationToken cancellationToken) =>
        Task.FromResult(LecturerStudentIds);
}

public sealed class FakeObjectStorage : IObjectStorage
{
    public readonly List<string> Uploaded = [];
    public readonly List<string> Deleted = [];
    public bool ThrowOnUpload;

    public Task<string> UploadAsync(string objectName, Stream data, string contentType, CancellationToken cancellationToken = default)
    {
        if (ThrowOnUpload)
        {
            throw new InvalidOperationException("Simulated storage failure.");
        }

        Uploaded.Add(objectName);
        return Task.FromResult(objectName);
    }

    public Task<Stream> DownloadAsync(string objectName, CancellationToken cancellationToken = default) =>
        Task.FromResult<Stream>(new MemoryStream());

    public Task DeleteAsync(string objectName, CancellationToken cancellationToken = default)
    {
        Deleted.Add(objectName);
        return Task.CompletedTask;
    }

    public Task<string> GetPresignedUrlAsync(string objectName, int expirySeconds = 3600, CancellationToken cancellationToken = default) =>
        Task.FromResult($"https://example.test/{objectName}");
}

public sealed class FakeEventBus : IEventBus
{
    public readonly List<IntegrationEvent> Published = [];

    public Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default) where TEvent : IntegrationEvent
    {
        Published.Add(@event);
        return Task.CompletedTask;
    }

    public void Subscribe<TEvent, THandler>()
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
    }
}

/// <summary>Captures every job enqueued via <c>BackgroundJob.Enqueue&lt;T&gt;</c> extension methods,
/// which funnel down to <see cref="Create"/> on this interface.</summary>
public sealed class FakeBackgroundJobClient : IBackgroundJobClient
{
    public readonly List<Job> CreatedJobs = [];

    public string Create(Job job, IState state)
    {
        CreatedJobs.Add(job);
        return Guid.NewGuid().ToString();
    }

    public bool ChangeState(string jobId, IState state, string expectedState) => true;
}
