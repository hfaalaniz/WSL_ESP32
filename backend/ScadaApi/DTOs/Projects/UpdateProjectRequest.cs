namespace ScadaApi.DTOs.Projects;

public record UpdateProjectRequest(
    string? Name,
    string? Description,
    string? Content
);
