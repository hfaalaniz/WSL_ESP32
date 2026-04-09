using Microsoft.EntityFrameworkCore;
using ScadaApi.Data;
using ScadaApi.DTOs.Projects;
using ScadaApi.Models;

namespace ScadaApi.Services;

public class ProjectService : IProjectService
{
    private readonly ScadaDbContext _db;
    private readonly ILogger<ProjectService> _logger;

    public ProjectService(ScadaDbContext db, ILogger<ProjectService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<ProjectSummary>> GetAllAsync(string? deviceId = null)
    {
        var query = _db.ScadaProjects.AsNoTracking();
        if (deviceId is not null)
        {
            query = query.Where(p => p.DeviceId == deviceId);
        }

        var projects = await query
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync();

        return projects.Select(ToSummary).ToList();
    }

    public async Task<string?> GetContentAsync(int id)
    {
        var project = await _db.ScadaProjects.FindAsync(id);
        return project?.Content;
    }

    public async Task<ProjectSummary?> GetMetaAsync(int id)
    {
        var project = await _db.ScadaProjects.FindAsync(id);
        return project is null ? null : ToSummary(project);
    }

    public async Task<ProjectSummary> CreateAsync(CreateProjectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
        {
            throw new ArgumentException("El contenido del proyecto no puede estar vacío", nameof(request.Content));
        }

        var project = new ScadaProject
        {
            Name        = request.Name,
            Description = request.Description ?? string.Empty,
            Author      = request.Author ?? "Usuario",
            DeviceId    = request.DeviceId,
            Content     = request.Content,
            CreatedAt   = DateTime.UtcNow,
            UpdatedAt   = DateTime.UtcNow,
        };

        _db.ScadaProjects.Add(project);
        await _db.SaveChangesAsync();

        return ToSummary(project);
    }

    public async Task<ProjectSummary?> UpdateAsync(int id, UpdateProjectRequest request)
    {
        var project = await _db.ScadaProjects.FindAsync(id);
        if (project is null)
        {
            return null;
        }

        if (request.Name is not null)
        {
            project.Name = request.Name;
        }

        if (request.Description is not null)
        {
            project.Description = request.Description;
        }

        if (request.Content is not null)
        {
            project.Content = request.Content;
        }

        project.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return ToSummary(project);
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var project = await _db.ScadaProjects.FindAsync(id);
        if (project is null)
        {
            return false;
        }

        _db.ScadaProjects.Remove(project);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<ProjectDownload?> GetDownloadAsync(int id)
    {
        var project = await _db.ScadaProjects.FindAsync(id);
        if (project is null)
        {
            return null;
        }

        var filename = project.Name.Replace(' ', '_') + ".scada";
        var content = System.Text.Encoding.UTF8.GetBytes(project.Content);
        return new ProjectDownload(filename, content);
    }

    private static ProjectSummary ToSummary(ScadaProject project) => new(
        project.Id,
        project.Name,
        project.Description,
        project.Author,
        project.DeviceId,
        project.Content.Length,
        project.CreatedAt,
        project.UpdatedAt
    );
}
