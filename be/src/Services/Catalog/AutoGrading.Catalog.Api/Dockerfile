FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 8081
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /bin/grpc_health_probe https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.24/grpc_health_probe-linux-amd64 \
    && chmod +x /bin/grpc_health_probe

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["be/Directory.Build.props", "be/"]
COPY ["be/src/BuildingBlocks/AutoGrading.Contracts/AutoGrading.Contracts.csproj", "be/src/BuildingBlocks/AutoGrading.Contracts/"]
COPY ["be/src/BuildingBlocks/AutoGrading.Common/AutoGrading.Common.csproj", "be/src/BuildingBlocks/AutoGrading.Common/"]
COPY ["be/src/Services/Catalog/AutoGrading.Catalog.Api/AutoGrading.Catalog.Api.csproj", "be/src/Services/Catalog/AutoGrading.Catalog.Api/"]
RUN dotnet restore "be/src/Services/Catalog/AutoGrading.Catalog.Api/AutoGrading.Catalog.Api.csproj"
COPY . .
WORKDIR "/src/be/src/Services/Catalog/AutoGrading.Catalog.Api"
RUN dotnet build "AutoGrading.Catalog.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "AutoGrading.Catalog.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "AutoGrading.Catalog.Api.dll"]
