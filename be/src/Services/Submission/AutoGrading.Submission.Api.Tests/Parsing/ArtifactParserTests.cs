using System.Text;
using AutoGrading.SubmissionSvc.Api.Domain;
using AutoGrading.SubmissionSvc.Api.Parsing;

namespace AutoGrading.Submission.Api.Tests.Parsing;

public class ArtifactParserTests
{
    private static Stream ToStream(string content) => new MemoryStream(Encoding.UTF8.GetBytes(content));

    [Fact]
    public async Task ParseAsync_DiagramKind_DelegatesToDrawioDiagramParser()
    {
        const string xml = """
            <mxGraphModel>
              <root>
                <mxCell id="1" value="Node" vertex="1" />
              </root>
            </mxGraphModel>
            """;

        var parser = new ArtifactParser(new DocxReportParser(), new DrawioDiagramParser());
        var result = await parser.ParseAsync(ArtifactKind.Diagram, ToStream(xml), "diagram.drawio");

        Assert.NotNull(result.Content);
        Assert.Contains("Node", result.Content);
    }

    [Fact]
    public async Task ParseAsync_UnsupportedKind_ThrowsArgumentOutOfRangeException()
    {
        var parser = new ArtifactParser(new DocxReportParser(), new DrawioDiagramParser());

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            parser.ParseAsync((ArtifactKind)999, ToStream("x"), "whatever"));
    }
}
