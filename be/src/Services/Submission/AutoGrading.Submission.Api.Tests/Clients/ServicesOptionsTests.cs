using AutoGrading.SubmissionSvc.Api.Clients;

namespace AutoGrading.Submission.Api.Tests.Clients;

public class ServicesOptionsTests
{
    [Fact]
    public void GetCatalogGrpcAddress_ConfiguredAddress_ReturnsUri()
    {
        var options = new ServicesOptions { CatalogGrpcAddress = "http://catalog-api:8081" };

        Assert.Equal(new Uri("http://catalog-api:8081"), options.GetCatalogGrpcAddress());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void GetCatalogGrpcAddress_MissingAddress_ThrowsClearError(string? address)
    {
        var options = new ServicesOptions { CatalogGrpcAddress = address! };

        var ex = Assert.Throws<InvalidOperationException>(() => options.GetCatalogGrpcAddress());
        Assert.Contains("CatalogGrpcAddress", ex.Message);
    }
}
