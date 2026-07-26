using AutoGrading.Common.Auth;
using AutoGrading.Common.Extensions;
using AutoGrading.Common.Jobs;
using AutoGrading.Common.Messaging;
using AutoGrading.Common.Ai;
using AutoGrading.Contracts.Events;
using AutoGrading.Grading.Api.Clients;
using AutoGrading.Grading.Api.Repository;
using AutoGrading.Grading.Api.Endpoints;
using AutoGrading.Grading.Api.Extensions;
using AutoGrading.Grading.Api.Handlers;
using AutoGrading.Grading.Api.Interfaces;
using AutoGrading.Grading.Api.Jobs;
using Hangfire;
using Microsoft.EntityFrameworkCore;

using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;

AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<GradingDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("GradingDb")));

builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddJwtTokenGenerator(builder.Configuration);
builder.Services.AddEventBus(builder.Configuration);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase)));

builder.Services.AddAiClient(builder.Configuration);
builder.Services.AddSingleton(sp => sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value);

builder.Services.Configure<ServicesOptions>(builder.Configuration.GetSection(ServicesOptions.SectionName));
var servicesOptions = builder.Configuration.GetSection(ServicesOptions.SectionName).Get<ServicesOptions>() ?? new ServicesOptions();

builder.Services.AddTransient<ServiceAuthHandler>();
builder.Services.AddGrpcClient<CatalogGrpcClient>(options =>
        options.Address = servicesOptions.GetCatalogGrpcAddress())
    .ConfigureChannel(options => options.UnsafeUseInsecureChannelCallCredentials = true)
    .AddCallCredentials((_, metadata, serviceProvider) =>
        CatalogGrpcAuthenticator.AttachServiceToken(serviceProvider.GetRequiredService<JwtTokenGenerator>(), "grading", metadata));
builder.Services.AddScoped<ICatalogApiClient, CatalogApiClient>();
builder.Services.AddHttpClient<ISubmissionApiClient, SubmissionApiClient>(client =>
        client.BaseAddress = new Uri(servicesOptions.SubmissionApiBaseUrl))
    .AddHttpMessageHandler<ServiceAuthHandler>();

builder.Services.AddGradingRepository().AddGradingApplication();
builder.Services.AddScoped<AiGradingJob>();
builder.Services.AddScoped<ArtifactsExtractedHandler>();
builder.Services.AddScoped<RubricConfirmedHandler>();
builder.Services.AddHostedService<GradePublishedOutboxDispatcher>();

builder.Services.AddHangfire(config => config
    .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UseSqlServerStorage(builder.Configuration.GetConnectionString("GradingDb")));
builder.Services.AddHangfireServer();

builder.Services.AddHealthChecks();

var app = builder.Build();

app.MigrateDatabase<GradingDbContext>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapGradesEndpoints();
app.MapHealthChecks("/health");
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new AllowAllDashboardAuthorizationFilter() }
});

var eventBus = app.Services.GetRequiredService<IEventBus>();
eventBus.Subscribe<ArtifactsExtracted, ArtifactsExtractedHandler>();
eventBus.Subscribe<RubricConfirmed, RubricConfirmedHandler>();

app.Run();
