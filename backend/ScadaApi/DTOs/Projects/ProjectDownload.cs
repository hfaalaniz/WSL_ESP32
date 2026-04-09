namespace ScadaApi.DTOs.Projects;

public record ProjectDownload(
    string Filename,
    byte[] Content
);
