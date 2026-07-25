using AutoGrading.Common.Auth;
using AutoGrading.Common.Extensions;
using AutoGrading.Common.Jobs;
using AutoGrading.Common.Messaging;
using AutoGrading.Contracts.Events;
using AutoGrading.SubmissionSvc.Api.Clients;
using AutoGrading.SubmissionSvc.Api.Endpoints;
using AutoGrading.SubmissionSvc.Api.Extensions;
using AutoGrading.SubmissionSvc.Api.Interfaces;
using AutoGrading.SubmissionSvc.Api.Jobs;
using AutoGrading.SubmissionSvc.Api.Parsing;
using AutoGrading.SubmissionSvc.Api.Repository;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using CatalogGrpcClient = AutoGrading.Catalog.Api.Grpc.Catalog.CatalogClient;

AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<SubmissionDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("SubmissionDb")));

builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddJwtTokenGenerator(builder.Configuration);
builder.Services.AddEventBus(builder.Configuration);
builder.Services.AddObjectStorage(builder.Configuration);

builder.Services.Configure<ServicesOptions>(builder.Configuration.GetSection(ServicesOptions.SectionName));
var servicesOptions = builder.Configuration.GetSection(ServicesOptions.SectionName).Get<ServicesOptions>() ?? new ServicesOptions();

builder.Services.AddGrpcClient<CatalogGrpcClient>(options =>
        options.Address = servicesOptions.GetCatalogGrpcAddress())
    .ConfigureChannel(options => options.UnsafeUseInsecureChannelCallCredentials = true)
    .AddCallCredentials((_, metadata, serviceProvider) =>
        CatalogGrpcAuthenticator.AttachServiceToken(serviceProvider.GetRequiredService<JwtTokenGenerator>(), "submission", metadata));
builder.Services.AddScoped<ICatalogApiClient, CatalogApiClient>();

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase)));

builder.Services.AddScoped<DocxReportParser>();
builder.Services.AddScoped<DrawioDiagramParser>();
builder.Services.AddScoped<IArtifactParser, ArtifactParser>();
builder.Services.AddSubmissionRepository().AddSubmissionApplication();
builder.Services.AddScoped<ExtractionJob>();
builder.Services.AddScoped<SubmissionUploadedHandler>();

builder.Services.AddHangfire(config => config
    .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UseSqlServerStorage(builder.Configuration.GetConnectionString("SubmissionDb")));
builder.Services.AddHangfireServer();

builder.Services.AddHealthChecks();

var app = builder.Build();

app.MigrateDatabase<SubmissionDbContext>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapSubmissionsEndpoints();
app.MapHealthChecks("/health");
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new AllowAllDashboardAuthorizationFilter() }
});

var eventBus = app.Services.GetRequiredService<IEventBus>();
eventBus.Subscribe<SubmissionUploaded, SubmissionUploadedHandler>();

app.Run();
