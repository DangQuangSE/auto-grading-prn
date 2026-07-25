using AutoGrading.SubmissionSvc.Api.Interfaces;
using AutoGrading.SubmissionSvc.Api.Service;

namespace AutoGrading.Submission.Api.Tests.Service;

public class SubmissionServiceTests
{
    private static (SubmissionService Service, FakeSubmissionRepository Repository, FakeCatalogApiClient Catalog,
        FakeObjectStorage Storage, FakeEventBus EventBus, FakeBackgroundJobClient Jobs) CreateService()
    {
        var repository = new FakeSubmissionRepository();
        var catalog = new FakeCatalogApiClient();
        var storage = new FakeObjectStorage();
        var eventBus = new FakeEventBus();
        var jobs = new FakeBackgroundJobClient();
        var service = new SubmissionService(repository, catalog, storage, eventBus, jobs);
        return (service, repository, catalog, storage, eventBus, jobs);
    }

    private static RequesterContext Student(Guid id) => new(id, IsStudent: true, IsLecturer: false, IsAdmin: false);
    private static RequesterContext Lecturer(Guid id) => new(id, IsStudent: false, IsLecturer: true, IsAdmin: false);
    private static RequesterContext Admin() => new(Guid.NewGuid(), IsStudent: false, IsLecturer: false, IsAdmin: true);

    [Fact]
    public async Task ListForRequesterAsync_Student_IsRestrictedToOwnSubmissions()
    {
        var (service, repository, _, _, _, _) = CreateService();
        var studentId = Guid.NewGuid();
        var other = Guid.NewGuid();
        repository.Items.Add(new AutoGrading.SubmissionSvc.Api.Domain.Submission { StudentId = studentId, AssignmentId = Guid.NewGuid() });
        repository.Items.Add(new AutoGrading.SubmissionSvc.Api.Domain.Submission { StudentId = other, AssignmentId = Guid.NewGuid() });

        var result = await service.ListForRequesterAsync(new SubmissionListQuery(null, null), Student(studentId), CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(studentId, result[0].StudentId);
    }

    [Fact]
    public async Task ListForRequesterAsync_Lecturer_WithoutAssignmentId_ThrowsValidationException()
    {
        var (service, _, _, _, _, _) = CreateService();

        await Assert.ThrowsAsync<SubmissionValidationException>(() =>
            service.ListForRequesterAsync(new SubmissionListQuery(null, null), Lecturer(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task ListForRequesterAsync_Lecturer_RestrictsToAllowedStudents()
    {
        var (service, repository, catalog, _, _, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        var subjectId = Guid.NewGuid();
        var lecturerId = Guid.NewGuid();
        var allowedStudent = Guid.NewGuid();
        var disallowedStudent = Guid.NewGuid();

        catalog.Assignment = new AssignmentDto(assignmentId, subjectId, 3);
        catalog.LecturerStudentIds = [allowedStudent];

        repository.Items.Add(new AutoGrading.SubmissionSvc.Api.Domain.Submission { AssignmentId = assignmentId, StudentId = allowedStudent });
        repository.Items.Add(new AutoGrading.SubmissionSvc.Api.Domain.Submission { AssignmentId = assignmentId, StudentId = disallowedStudent });

        var result = await service.ListForRequesterAsync(new SubmissionListQuery(assignmentId, null), Lecturer(lecturerId), CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(allowedStudent, result[0].StudentId);
    }

    [Fact]
    public async Task GetForRequesterAsync_UnknownId_ThrowsNotFound()
    {
        var (service, _, _, _, _, _) = CreateService();

        await Assert.ThrowsAsync<SubmissionNotFoundException>(() =>
            service.GetForRequesterAsync(Guid.NewGuid(), Admin(), CancellationToken.None));
    }

    [Fact]
    public async Task GetForRequesterAsync_StudentAccessingOthersSubmission_ThrowsForbidden()
    {
        var (service, repository, _, _, _, _) = CreateService();
        var submission = new AutoGrading.SubmissionSvc.Api.Domain.Submission { StudentId = Guid.NewGuid() };
        repository.Items.Add(submission);

        await Assert.ThrowsAsync<SubmissionForbiddenException>(() =>
            service.GetForRequesterAsync(submission.Id, Student(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task GetForRequesterAsync_Admin_CanAccessAnySubmission()
    {
        var (service, repository, _, _, _, _) = CreateService();
        var submission = new AutoGrading.SubmissionSvc.Api.Domain.Submission { StudentId = Guid.NewGuid() };
        repository.Items.Add(submission);

        var result = await service.GetForRequesterAsync(submission.Id, Admin(), CancellationToken.None);

        Assert.Equal(submission.Id, result.Id);
    }

    [Fact]
    public async Task UploadAsync_UnknownAssignment_ThrowsAssignmentNotFound()
    {
        var (service, _, catalog, _, _, _) = CreateService();
        catalog.Assignment = null;

        var command = new UploadSubmissionCommand(Guid.NewGuid(), Guid.NewGuid(), new MemoryStream(), "r.docx", "application/octet", null, null, null);

        await Assert.ThrowsAsync<SubmissionAssignmentNotFoundException>(() =>
            service.UploadAsync(command, Admin(), CancellationToken.None));
    }

    [Fact]
    public async Task UploadAsync_LecturerWithoutStudentId_ThrowsValidationException()
    {
        var (service, _, catalog, _, _, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        catalog.Assignment = new AssignmentDto(assignmentId, Guid.NewGuid(), 3);

        var command = new UploadSubmissionCommand(assignmentId, null, new MemoryStream(), "r.docx", "application/octet", null, null, null);

        await Assert.ThrowsAsync<SubmissionValidationException>(() =>
            service.UploadAsync(command, Lecturer(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task UploadAsync_StudentUpload_UsesRequesterIdAndPublishesEvents()
    {
        var (service, repository, catalog, storage, eventBus, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        catalog.Assignment = new AssignmentDto(assignmentId, Guid.NewGuid(), 3);

        var command = new UploadSubmissionCommand(assignmentId, null, new MemoryStream([1, 2, 3]), "report.docx", "application/vnd", null, null, null);

        var submission = await service.UploadAsync(command, Student(studentId), CancellationToken.None);

        Assert.Equal(studentId, submission.StudentId);
        Assert.Single(storage.Uploaded);
        Assert.Equal(2, eventBus.Published.Count);
        Assert.Contains(repository.Items, s => s.Id == submission.Id);
    }

    [Fact]
    public async Task UploadAsync_WithDiagram_UploadsBothFiles()
    {
        var (service, _, catalog, storage, _, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        catalog.Assignment = new AssignmentDto(assignmentId, Guid.NewGuid(), 3);

        var command = new UploadSubmissionCommand(
            assignmentId, Guid.NewGuid(), new MemoryStream([1]), "report.docx", "application/vnd",
            new MemoryStream([2]), "diagram.drawio", "application/xml");

        var submission = await service.UploadAsync(command, Admin(), CancellationToken.None);

        Assert.Equal(2, storage.Uploaded.Count);
        Assert.NotNull(submission.DiagramObjectKey);
    }

    [Fact]
    public async Task UploadAsync_StorageFailure_RollsBackSubmissionAndUploadedFile()
    {
        var (service, repository, catalog, storage, _, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        catalog.Assignment = new AssignmentDto(assignmentId, Guid.NewGuid(), 3);
        storage.ThrowOnUpload = true;

        var command = new UploadSubmissionCommand(assignmentId, Guid.NewGuid(), new MemoryStream([1]), "report.docx", "application/vnd", null, null, null);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UploadAsync(command, Admin(), CancellationToken.None));

        Assert.True(repository.DeleteCalled);
        Assert.Empty(repository.Items);
    }

    [Fact]
    public async Task RetryAsync_UnknownSubmission_ThrowsNotFound()
    {
        var (service, _, _, _, _, _) = CreateService();

        await Assert.ThrowsAsync<SubmissionNotFoundException>(() =>
            service.RetryAsync(Guid.NewGuid(), Admin(), CancellationToken.None));
    }

    [Fact]
    public async Task RetryAsync_Authorized_ResetsAndEnqueuesExtractionJob()
    {
        var (service, repository, _, _, _, jobs) = CreateService();
        var studentId = Guid.NewGuid();
        var submission = new AutoGrading.SubmissionSvc.Api.Domain.Submission { StudentId = studentId };
        repository.Items.Add(submission);

        await service.RetryAsync(submission.Id, Student(studentId), CancellationToken.None);

        Assert.Equal(submission.Id, repository.ResetForRetryCalledWith);
        Assert.Single(jobs.CreatedJobs);
    }

    [Fact]
    public async Task RetryAsync_StudentRetryingOthersSubmission_ThrowsForbidden()
    {
        var (service, repository, _, _, _, _) = CreateService();
        var submission = new AutoGrading.SubmissionSvc.Api.Domain.Submission { StudentId = Guid.NewGuid() };
        repository.Items.Add(submission);

        await Assert.ThrowsAsync<SubmissionForbiddenException>(() =>
            service.RetryAsync(submission.Id, Student(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task RetryAsync_LecturerNotAllowedForStudent_ThrowsForbidden()
    {
        var (service, repository, catalog, _, _, _) = CreateService();
        var assignmentId = Guid.NewGuid();
        var submission = new AutoGrading.SubmissionSvc.Api.Domain.Submission { AssignmentId = assignmentId, StudentId = Guid.NewGuid() };
        repository.Items.Add(submission);
        catalog.Assignment = new AssignmentDto(assignmentId, Guid.NewGuid(), 3);
        catalog.LecturerStudentIds = []; // lecturer teaches nobody relevant

        await Assert.ThrowsAsync<SubmissionForbiddenException>(() =>
            service.RetryAsync(submission.Id, Lecturer(Guid.NewGuid()), CancellationToken.None));
    }
}
