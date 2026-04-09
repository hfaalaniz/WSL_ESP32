using Swashbuckle.AspNetCore.Filters;
using ScadaApi.DTOs.Projects;

namespace ScadaApi.Examples;

public class CreateProjectRequestExample : IExamplesProvider<CreateProjectRequest>
{
    public CreateProjectRequest GetExamples()
    {
        return new CreateProjectRequest(
            Name: "Mi Proyecto SCADA",
            Description: "Sistema de control para línea de producción",
            Author: "Juan Pérez",
            DeviceId: "esp01",
            Content: @"# Proyecto SCADA v1.0
tag esp01.595.out.0 = false
tag esp01.analog.in.0 = 0.0
alarm esp01.temp > 80.0 : ""Temperatura alta""
"
        );
    }
}

public class ProjectSummaryExample : IExamplesProvider<ProjectSummary>
{
    public ProjectSummary GetExamples()
    {
        return new ProjectSummary(
            Id: 42,
            Name: "Sistema de Control Industrial",
            Description: "Monitoreo y control de línea de producción automatizada",
            Author: "María García",
            DeviceId: "esp01",
            ContentLength: 1024,
            CreatedAt: DateTime.UtcNow.AddDays(-7),
            UpdatedAt: DateTime.UtcNow.AddHours(-2)
        );
    }
}

public class UpdateProjectRequestExample : IExamplesProvider<UpdateProjectRequest>
{
    public UpdateProjectRequest GetExamples()
    {
        return new UpdateProjectRequest(
            Name: "Sistema Actualizado",
            Description: "Versión mejorada con nuevas alarmas",
            Content: @"# Proyecto SCADA v2.0
tag esp01.595.out.0 = false
tag esp01.analog.in.0 = 0.0
tag esp01.digital.in.1 = true
alarm esp01.temp > 80.0 : ""Temperatura alta""
alarm esp01.pressure < 10.0 : ""Presión baja""
"
        );
    }
}
