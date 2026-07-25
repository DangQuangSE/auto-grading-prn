using AutoGrading.Catalog.Api.Grpc;
using AutoGrading.SubmissionSvc.Api.Clients;
using Grpc.Core;
using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;

namespace AutoGrading.Submission.Api.Tests.Clients;

public class CatalogApiClientTests
{
    private sealed class FakeCatalogClient : CatalogGrpcClient
    {
        public AssignmentReply? AssignmentReply { get; set; }
        public RpcException? AssignmentError { get; set; }
        public GetLecturerStudentIdsReply StudentIdsReply { get; set; } = new();

        public override AsyncUnaryCall<AssignmentReply> GetAssignmentAsync(
            GetAssignmentRequest request, Metadata? headers = null, DateTime? deadline = null, CancellationToken cancellationToken = default) =>
            Wrap(AssignmentError is not null ? Task.FromException<AssignmentReply>(AssignmentError) : Task.FromResult(AssignmentReply!));

        public override AsyncUnaryCall<GetLecturerStudentIdsReply> GetLecturerStudentIdsAsync(
            GetLecturerStudentIdsRequest request, Metadata? headers = null, DateTime? deadline = null, CancellationToken cancellationToken = default) =>
            Wrap(Task.FromResult(StudentIdsReply));

        private static AsyncUnaryCall<T> Wrap<T>(Task<T> responseAsync) =>
            new(responseAsync, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
    }

    [Fact]
    public async Task GetAssignmentAsync_ExistingAssignment_MapsAllFieldsToDto()
    {
        var assignmentId = Guid.NewGuid();
        var subjectId = Guid.NewGuid();
        var fake = new FakeCatalogClient
        {
            AssignmentReply = new AssignmentReply
            {
                Id = assignmentId.ToString(),
                SubjectId = subjectId.ToString(),
                Title = "Assignment 1",
                MaxAttempts = 3,
            },
        };
        var client = new CatalogApiClient(fake);

        var dto = await client.GetAssignmentAsync(assignmentId, CancellationToken.None);

        Assert.NotNull(dto);
        Assert.Equal(assignmentId, dto!.Id);
        Assert.Equal(subjectId, dto.SubjectId);
        Assert.Equal(3, dto.MaxAttempts);
    }

    [Fact]
    public async Task GetAssignmentAsync_NotFoundOnServer_ReturnsNull()
    {
        var fake = new FakeCatalogClient { AssignmentError = new RpcException(new Status(StatusCode.NotFound, "not found")) };
        var client = new CatalogApiClient(fake);

        var dto = await client.GetAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(dto);
    }

    [Fact]
    public async Task GetLecturerStudentIdsAsync_MapsReplyIdsToGuidSet()
    {
        var id1 = Guid.NewGuid();
        var id2 = Guid.NewGuid();
        var reply = new GetLecturerStudentIdsReply();
        reply.StudentIds.Add(id1.ToString());
        reply.StudentIds.Add(id2.ToString());
        var fake = new FakeCatalogClient { StudentIdsReply = reply };
        var client = new CatalogApiClient(fake);

        var result = await client.GetLecturerStudentIdsAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(new HashSet<Guid> { id1, id2 }, result);
    }

    [Fact]
    public async Task GetLecturerStudentIdsAsync_NoStudentsInReply_ReturnsEmptySet()
    {
        var fake = new FakeCatalogClient { StudentIdsReply = new GetLecturerStudentIdsReply() };
        var client = new CatalogApiClient(fake);

        var result = await client.GetLecturerStudentIdsAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None);

        Assert.Empty(result);
    }
}
