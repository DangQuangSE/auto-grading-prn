using System.Net;
using System.Text;
using AutoGrading.Common.Ai;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AutoGrading.Common.Tests.Ai;

public class ParseRubricCriteriaAsyncTests
{
    private static AiClient CreateClient(string chatCompletionContent)
    {
        var handler = new StubHttpMessageHandler(BuildChatCompletionPayload(chatCompletionContent));
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://ai.example/") };
        var options = Options.Create(new AiOptions { ApiKey = "test-key" });

        return new AiClient(httpClient, options, NullLogger<AiClient>.Instance);
    }

    private static string BuildChatCompletionPayload(string messageContent)
    {
        var escaped = System.Text.Json.JsonSerializer.Serialize(messageContent);
        return $$"""
                 {
                   "choices": [
                     { "message": { "content": {{escaped}} } }
                   ]
                 }
                 """;
    }

    [Fact]
    public async Task WellFormedResponse_ParsesIntoExpectedCriteria()
    {
        var content = """
            [
              { "name": "Correctness", "description": "Solution is correct", "maxScore": 40, "order": 0 },
              { "name": "Code Quality", "description": "Clean and idiomatic", "maxScore": 30, "order": 1 },
              { "name": "Documentation", "description": "", "maxScore": 30, "order": 2 }
            ]
            """;
        var client = CreateClient(content);

        var result = await client.ParseRubricCriteriaAsync("some rubric document text", CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Equal("Correctness", result[0].Name);
        Assert.Equal(40m, result[0].MaxScore);
        Assert.Equal(0, result[0].Order);
        Assert.Equal("Code Quality", result[1].Name);
        Assert.Equal("Documentation", result[2].Name);
    }

    [Fact]
    public async Task MalformedResponse_MissingFields_SkipsInvalidItemsWithoutThrowing()
    {
        var content = """
            [
              { "name": "Correctness", "maxScore": 40 },
              { "description": "no name or score" },
              { "name": "", "maxScore": 10 }
            ]
            """;
        var client = CreateClient(content);

        var result = await client.ParseRubricCriteriaAsync("some rubric document text", CancellationToken.None);

        var criterion = Assert.Single(result);
        Assert.Equal("Correctness", criterion.Name);
    }

    [Fact]
    public async Task ResponseWrappedInMarkdownCodeFence_StripsFenceAndParsesCriteria()
    {
        var content = """
            ```json
            [
              { "name": "Correctness", "description": "Solution is correct", "maxScore": 40, "order": 0 }
            ]
            ```
            """;
        var client = CreateClient(content);

        var result = await client.ParseRubricCriteriaAsync("some rubric document text", CancellationToken.None);

        var criterion = Assert.Single(result);
        Assert.Equal("Correctness", criterion.Name);
        Assert.Equal(40m, criterion.MaxScore);
    }

    [Fact]
    public async Task MalformedResponse_NonJsonContent_FallsBackToStubWithoutThrowing()
    {
        var client = CreateClient("this is not valid json at all");

        var result = await client.ParseRubricCriteriaAsync("some rubric document text", CancellationToken.None);

        Assert.NotEmpty(result);
    }

    private sealed class StubHttpMessageHandler(string responseBody) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
            };

            return Task.FromResult(response);
        }
    }
}
