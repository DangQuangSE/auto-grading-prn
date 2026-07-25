using AutoGrading.SubmissionSvc.Api.Parsing;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace AutoGrading.Submission.Api.Tests.Parsing;

public class DocxReportParserTests
{
    private static MemoryStream BuildDocx(Action<Body> configureBody, Action<MainDocumentPart>? configureParts = null)
    {
        var stream = new MemoryStream();
        using (var document = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document, autoSave: true))
        {
            var mainPart = document.AddMainDocumentPart();
            mainPart.Document = new Document();
            var body = new Body();
            configureBody(body);
            mainPart.Document.Append(body);
            configureParts?.Invoke(mainPart);
            mainPart.Document.Save();
        }

        stream.Position = 0;
        return stream;
    }

    private static Paragraph HeadingParagraph(string text, string styleId = "Heading1")
    {
        var paragraph = new Paragraph(new ParagraphProperties(new ParagraphStyleId { Val = styleId }));
        paragraph.Append(new Run(new Text(text)));
        return paragraph;
    }

    private static Paragraph BodyParagraph(string text)
    {
        var paragraph = new Paragraph();
        paragraph.Append(new Run(new Text(text)));
        return paragraph;
    }

    [Fact]
    public async Task ParseAsync_HeadingsGroupFollowingParagraphs()
    {
        using var stream = BuildDocx(body =>
        {
            body.Append(HeadingParagraph("Introduction"));
            body.Append(BodyParagraph("This is the intro text."));
            body.Append(HeadingParagraph("Conclusion"));
            body.Append(BodyParagraph("This is the conclusion text."));
        });

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.NotNull(result.Content);
        Assert.Contains("## Introduction", result.Content);
        Assert.Contains("This is the intro text.", result.Content);
        Assert.Contains("## Conclusion", result.Content);
        Assert.Contains("This is the conclusion text.", result.Content);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task ParseAsync_ParagraphsBeforeAnyHeading_GoUnderUntitled()
    {
        using var stream = BuildDocx(body =>
        {
            body.Append(BodyParagraph("Leading paragraph with no heading."));
        });

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.NotNull(result.Content);
        Assert.Contains("## Untitled", result.Content);
        Assert.Contains("Leading paragraph with no heading.", result.Content);
    }

    [Fact]
    public async Task ParseAsync_EmptyParagraphsAreSkipped()
    {
        using var stream = BuildDocx(body =>
        {
            body.Append(HeadingParagraph("Section"));
            body.Append(new Paragraph()); // no runs/text at all
            body.Append(BodyParagraph("   ")); // whitespace-only text
            body.Append(BodyParagraph("Real content."));
        });

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.NotNull(result.Content);
        Assert.Contains("Real content.", result.Content);
        // Only the heading + one real content line should appear (no stray blank lines from skipped paragraphs).
        var sectionBody = result.Content!.Split("## Section")[1].Trim();
        Assert.Equal("Real content.", sectionBody);
    }

    [Fact]
    public async Task ParseAsync_NoBodyContentAndNoImages_ReturnsNullContentWithWarning()
    {
        using var stream = BuildDocx(_ => { });

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.Null(result.Content);
        Assert.Single(result.Warnings);
        Assert.Contains("No text content", result.Warnings[0]);
    }

    [Fact]
    public async Task ParseAsync_MissingDocumentBody_ReturnsNullContentWithWarning()
    {
        var stream = new MemoryStream();
        using (var document = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document, autoSave: true))
        {
            var mainPart = document.AddMainDocumentPart();
            mainPart.Document = new Document();
            // Intentionally do not append a Body element, so MainDocumentPart.Document.Body is null.
            mainPart.Document.Save();
        }
        stream.Position = 0;

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.Null(result.Content);
        Assert.Single(result.Warnings);
        Assert.Contains("no readable body content", result.Warnings[0]);
    }

    [Fact]
    public async Task ParseAsync_EmbeddedImage_IsExtractedAsBase64DataUrl()
    {
        using var stream = BuildDocx(
            body => body.Append(HeadingParagraph("Diagram"), BodyParagraph("See attached image.")),
            mainPart =>
            {
                var imagePart = mainPart.AddImagePart(ImagePartType.Png);
                var bytes = new byte[] { 137, 80, 78, 71, 1, 2, 3, 4 }; // fake but non-empty bytes
                using var imgStream = new MemoryStream(bytes);
                imagePart.FeedData(imgStream);
            });

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.NotNull(result.ImageDataUrls);
        Assert.Single(result.ImageDataUrls!);
        Assert.StartsWith("data:image/png;base64,", result.ImageDataUrls![0]);
    }

    [Fact]
    public async Task ParseAsync_TooManyImages_SkipsBeyondMaxAndWarns()
    {
        using var stream = BuildDocx(
            body => body.Append(HeadingParagraph("Diagrams"), BodyParagraph("Multiple images.")),
            mainPart =>
            {
                // MaxImages is 8 in the parser; add 9 to force one skip.
                for (var i = 0; i < 9; i++)
                {
                    var imagePart = mainPart.AddImagePart(ImagePartType.Png);
                    using var imgStream = new MemoryStream(new byte[] { 1, 2, 3, 4 });
                    imagePart.FeedData(imgStream);
                }
            });

        var parser = new DocxReportParser();
        var result = await parser.ParseAsync(stream, "report.docx");

        Assert.NotNull(result.ImageDataUrls);
        Assert.Equal(8, result.ImageDataUrls!.Length);
        Assert.Single(result.Warnings);
        Assert.Contains("1 embedded image(s) were skipped", result.Warnings[0]);
    }
}
