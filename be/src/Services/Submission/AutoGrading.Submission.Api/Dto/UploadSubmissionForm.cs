namespace AutoGrading.SubmissionSvc.Api.Dto;

public sealed class UploadSubmissionForm
{
    public Guid AssignmentId { get; set; }
    public Guid? StudentId { get; set; }
    public IFormFile ReportFile { get; set; } = null!;
}
