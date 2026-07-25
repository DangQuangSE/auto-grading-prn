using AutoGrading.Catalog.Api.Grpc;
using AutoGrading.Grading.Api.Clients;
using Grpc.Core;
using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;

namespace AutoGrading.Grading.Api.Tests.Clients;

public class CatalogApiClientTests
{
    private sealed class FakeCatalogClient : CatalogGrpcClient
    {
        public AssignmentReply? AssignmentReply { get; set; }
        public RpcException? AssignmentError { get; set; }
        public GetCriteriaForAssignmentReply CriteriaReply { get; set; } = new();
        public GetLecturerStudentIdsReply StudentIdsReply { get; set; } = new();

        public override AsyncUnaryCall<AssignmentReply> GetAssignmentAsync(
            GetAssignmentRequest request, Metadata? headers = null, DateTime? deadline = null, CancellationToken cancellationToken = default) =>
            Wrap(AssignmentError is not null ? Task.FromException<AssignmentReply>(AssignmentError) : Task.FromResult(AssignmentReply!));

        public override AsyncUnaryCall<GetCriteriaForAssignmentReply> GetCriteriaForAssignmentAsync(
            GetCriteriaForAssignmentRequest request, Metadata? headers = null, DateTime? deadline = null, CancellationToken cancellationToken = default) =>
            Wrap(Task.FromResult(CriteriaReply));

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
                Description = "desc",
            },
        };
        var client = new CatalogApiClient(fake);

        var dto = await client.GetAssignmentAsync(assignmentId, CancellationToken.None);

        Assert.NotNull(dto);
        Assert.Equal(assignmentId, dto!.Id);
        Assert.Equal(subjectId, dto.SubjectId);
        Assert.Equal("Assignment 1", dto.Title);
        Assert.Equal("desc", dto.Description);
    }

    [Fact]
    public async Task GetAssignmentAsync_ReplyWithoutDescription_MapsToNullDescription()
    {
        var fake = new FakeCatalogClient
        {
            AssignmentReply = new AssignmentReply
            {
                Id = Guid.NewGuid().ToString(),
                SubjectId = Guid.NewGuid().ToString(),
                Title = "No description",
            },
        };
        var client = new CatalogApiClient(fake);

        var dto = await client.GetAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(dto!.Description);
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
    public async Task GetCriteriaForAssignmentAsync_MapsAllCriterionFields()
    {
        var criterionId = Guid.NewGuid();
        var reply = new GetCriteriaForAssignmentReply();
        reply.Criteria.Add(new RubricCriterionReply
        {
            Id = criterionId.ToString(),
            Code = "C1",
            Name = "Criterion 1",
            Description = "d",
            MaxScore = "12.5",
            OrderIndex = 2,
        });
        var fake = new FakeCatalogClient { CriteriaReply = reply };
        var client = new CatalogApiClient(fake);

        var result = await client.GetCriteriaForAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        var criterion = Assert.Single(result);
        Assert.Equal(criterionId, criterion.Id);
        Assert.Equal("C1", criterion.Code);
        Assert.Equal("Criterion 1", criterion.Name);
        Assert.Equal("d", criterion.Description);
        Assert.Equal(12.5m, criterion.MaxScore);
        Assert.Equal(2, criterion.OrderIndex);
    }

    [Fact]
    public async Task GetCriteriaForAssignmentAsync_CriterionWithoutDescription_MapsToNullDescription()
    {
        var reply = new GetCriteriaForAssignmentReply();
        reply.Criteria.Add(new RubricCriterionReply
        {
            Id = Guid.NewGuid().ToString(),
            Code = "C1",
            Name = "Criterion 1",
            MaxScore = "10",
            OrderIndex = 0,
        });
        var fake = new FakeCatalogClient { CriteriaReply = reply };
        var client = new CatalogApiClient(fake);

        var result = await client.GetCriteriaForAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(Assert.Single(result).Description);
    }

    [Fact]
    public async Task GetCriteriaForAssignmentAsync_NoCriteriaInReply_ReturnsEmptyList()
    {
        var fake = new FakeCatalogClient { CriteriaReply = new GetCriteriaForAssignmentReply() };
        var client = new CatalogApiClient(fake);

        var result = await client.GetCriteriaForAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Empty(result);
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
