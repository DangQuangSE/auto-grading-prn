using System.Text.Json.Serialization;

namespace AutoGrading.Catalog.Api.Domain;

public class Assignment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SubjectId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public int MaxAttempts { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public Subject? Subject { get; set; }

    [JsonIgnore]
    public List<Rubric> Rubrics { get; set; } = new();
}
