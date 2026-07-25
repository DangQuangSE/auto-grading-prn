namespace AutoGrading.Grading.Api.Clients;

public sealed class ServicesOptions
{
    public const string SectionName = "Services";

    public string CatalogGrpcAddress { get; set; } = string.Empty;
    public string SubmissionApiBaseUrl { get; set; } = string.Empty;

    public Uri GetCatalogGrpcAddress() =>
        string.IsNullOrWhiteSpace(CatalogGrpcAddress)
            ? throw new InvalidOperationException("Services:CatalogGrpcAddress must be configured.")
            : new Uri(CatalogGrpcAddress);
}
