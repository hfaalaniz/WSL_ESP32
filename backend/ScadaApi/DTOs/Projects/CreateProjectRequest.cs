namespace ScadaApi.DTOs.Projects;

public record CreateProjectRequest(
    string  Name,
    string? Description,
    string? Author,
    string? DeviceId,
    string  Content
);
