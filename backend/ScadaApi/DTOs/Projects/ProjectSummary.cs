namespace ScadaApi.DTOs.Projects;

public record ProjectSummary(
    int      Id,
    string   Name,
    string   Description,
    string   Author,
    string?  DeviceId,
    int      ContentLength,
    DateTime CreatedAt,
    DateTime UpdatedAt
);
