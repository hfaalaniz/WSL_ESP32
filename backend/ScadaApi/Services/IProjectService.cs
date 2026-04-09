using ScadaApi.DTOs.Projects;

namespace ScadaApi.Services;

public interface IProjectService
{
    Task<List<ProjectSummary>> GetAllAsync(string? deviceId = null);
    Task<string?> GetContentAsync(int id);
    Task<ProjectSummary?> GetMetaAsync(int id);
    Task<ProjectSummary> CreateAsync(CreateProjectRequest request);
    Task<ProjectSummary?> UpdateAsync(int id, UpdateProjectRequest request);
    Task<bool> DeleteAsync(int id);
    Task<ProjectDownload?> GetDownloadAsync(int id);
}
