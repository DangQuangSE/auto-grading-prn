using System.IO.Compression;
using System.Text;
using AutoGrading.SubmissionSvc.Api.Parsing;

namespace AutoGrading.Submission.Api.Tests.Parsing;

public class DrawioDiagramParserTests
{
    private static Stream ToStream(string content) => new MemoryStream(Encoding.UTF8.GetBytes(content));

    [Fact]
    public async Task ParseAsync_PlainXmlWithComponentsAndConnectors_ExtractsBoth()
    {
        const string xml = """
            <mxfile>
              <diagram>
                <mxGraphModel>
                  <root>
                    <mxCell id="1" value="Client" vertex="1" />
                    <mxCell id="2" value="Server" vertex="1" />
                    <mxCell id="3" value="calls" edge="1" source="1" target="2" />
                  </root>
                </mxGraphModel>
              </diagram>
            </mxfile>
            """;

        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream(xml), "diagram.drawio");

        Assert.NotNull(result.Content);
        Assert.Contains("## Components", result.Content);
        Assert.Contains("Client", result.Content);
        Assert.Contains("Server", result.Content);
        Assert.Contains("## Connectors", result.Content);
        Assert.Contains("Client -> Server (calls)", result.Content);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task ParseAsync_ConnectorWithoutLabel_OmitsParenSuffix()
    {
        const string xml = """
            <mxGraphModel>
              <root>
                <mxCell id="1" value="A" vertex="1" />
                <mxCell id="2" value="B" vertex="1" />
                <mxCell id="3" edge="1" source="1" target="2" />
              </root>
            </mxGraphModel>
            """;

        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream(xml), "diagram.drawio");

        Assert.NotNull(result.Content);
        Assert.Contains("A -> B", result.Content);
        Assert.DoesNotContain("A -> B (", result.Content);
    }

    [Fact]
    public async Task ParseAsync_HtmlEncodedLabels_AreDecoded()
    {
        const string xml = """
            <mxGraphModel>
              <root>
                <mxCell id="1" value="A &amp; B" vertex="1" />
              </root>
            </mxGraphModel>
            """;

        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream(xml), "diagram.drawio");

        Assert.NotNull(result.Content);
        Assert.Contains("A & B", result.Content);
    }

    [Fact]
    public async Task ParseAsync_InvalidXml_ReturnsWarning()
    {
        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream("<not-closed"), "diagram.drawio");

        Assert.Null(result.Content);
        Assert.Single(result.Warnings);
        Assert.Contains("not valid XML", result.Warnings[0]);
    }

    [Fact]
    public async Task ParseAsync_NoGraphModel_ReturnsWarning()
    {
        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream("<mxfile><diagram></diagram></mxfile>"), "diagram.drawio");

        Assert.Null(result.Content);
        Assert.Contains(result.Warnings, w => w.Contains("No mxGraphModel"));
    }

    [Fact]
    public async Task ParseAsync_NoLabeledComponentsOrConnectors_ReturnsWarning()
    {
        const string xml = """
            <mxGraphModel>
              <root>
                <mxCell id="1" vertex="1" />
              </root>
            </mxGraphModel>
            """;

        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream(xml), "diagram.drawio");

        Assert.Null(result.Content);
        Assert.Contains(result.Warnings, w => w.Contains("No labeled components or connectors"));
    }

    [Fact]
    public async Task ParseAsync_CompressedDiagram_IsDecodedAndParsed()
    {
        const string inner = """<mxGraphModel><root><mxCell id="1" value="Node" vertex="1" /></root></mxGraphModel>""";
        var escaped = Uri.EscapeDataString(inner);
        var compressed = Compress(escaped);
        var encoded = Convert.ToBase64String(compressed);

        var xml = $"<mxfile><diagram>{encoded}</diagram></mxfile>";

        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream(xml), "diagram.drawio");

        Assert.NotNull(result.Content);
        Assert.Contains("Node", result.Content);
    }

    [Fact]
    public async Task ParseAsync_CompressedDiagram_InvalidBase64_ReturnsWarning()
    {
        var xml = "<mxfile><diagram>not-valid-base64!!!</diagram></mxfile>";

        var parser = new DrawioDiagramParser();
        var result = await parser.ParseAsync(ToStream(xml), "diagram.drawio");

        Assert.Null(result.Content);
        Assert.Contains(result.Warnings, w => w.Contains("Failed to decode compressed diagram content"));
    }

    private static byte[] Compress(string raw)
    {
        using var output = new MemoryStream();
        using (var deflate = new DeflateStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            var bytes = Encoding.UTF8.GetBytes(raw);
            deflate.Write(bytes, 0, bytes.Length);
        }

        return output.ToArray();
    }
}
