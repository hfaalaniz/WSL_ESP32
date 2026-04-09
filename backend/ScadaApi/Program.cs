using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;
using ScadaApi.Middleware;
using ScadaApi.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Logging ────────────────────────────────────────────────────────────────────

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
if (builder.Environment.IsDevelopment())
{
    builder.Logging.AddDebug();
}

// ── Servicios ──────────────────────────────────────────────────────────────────

builder.Services.AddControllers()
    .AddJsonOptions(opt =>
    {
        opt.JsonSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;
        opt.JsonSerializerOptions.DefaultIgnoreCondition =
            System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new()
    {
        Title       = "WSL SCADA API",
        Version     = "v1",
        Description = "API REST para el sistema SCADA basado en ESP32. " +
                      "Gestiona dispositivos, telemetría, alarmas, " +
                      "proyectos .scada y cola de comandos.",
    });

    var xmlFile = $"{System.Reflection.Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    c.IncludeXmlComments(xmlPath, includeControllerXmlComments: true);
});

// ── Inyección de servicios de negocio ──────────────────────────────────────────
builder.Services.AddScoped<IDeviceService, DeviceService>();
builder.Services.AddScoped<ITelemetryService, TelemetryService>();
builder.Services.AddScoped<IAlarmService, AlarmService>();
builder.Services.AddScoped<ICommandService, CommandService>();
builder.Services.AddScoped<IProjectService, ProjectService>();
builder.Services.AddScoped<ICompilationService, CompilationService>();

// ── Base de datos ──────────────────────────────────────────────────────────────
// Sin ConnectionString → InMemory (desarrollo/tests)
// Con ConnectionString → PostgreSQL (producción)

var connStr = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connStr))
{
    builder.Services.AddDbContext<ScadaDbContext>(opt =>
        opt.UseInMemoryDatabase("ScadaDev"));
}
else
{
    builder.Services.AddDbContext<ScadaDbContext>(opt =>
        opt.UseNpgsql(connStr, npg => npg.EnableRetryOnFailure()));
}

// ── CORS ───────────────────────────────────────────────────────────────────────
// En desarrollo: permitir localhost
// En producción: restringir a dominio específico
var corsOrigins = builder.Configuration.GetValue<string>("CorsOrigins")?
    .Split(';') ?? new[] { "http://localhost:3000", "http://localhost:5173", "http://localhost:5180" };

builder.Services.AddCors(opt =>
    opt.AddDefaultPolicy(p =>
        p.WithOrigins(corsOrigins)
         .AllowAnyMethod()
         .AllowAnyHeader()
    )
);

var app = builder.Build();

// ── Auto-creación del schema ───────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
    db.Database.EnsureCreated();
    app.Logger.LogInformation("Database initialized");
}

// ── Pipeline ───────────────────────────────────────────────────────────────────

// CORS debe ir primero para que los preflight OPTIONS reciban el header correcto
app.UseCors();

// Middleware de error handling global
app.UseExceptionHandling();

app.UseSwagger();
app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "WSL SCADA API v1");
    c.RoutePrefix = "";
    c.DocumentTitle = "WSL SCADA API";
});

app.MapControllers();

app.Logger.LogInformation("WSL SCADA API started in {Environment} mode", app.Environment.EnvironmentName);
app.Urls.Add("http://localhost:5000");
app.Run();
