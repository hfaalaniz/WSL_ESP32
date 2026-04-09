using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using ScadaApi.Data;
using ScadaApi.DTOs.Projects;
using ScadaApi.Models;
using ScadaApi.Services;

namespace ScadaApi.Tests.Services;

public class ProjectServiceTests
{
    private ScadaDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ScadaDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ScadaDbContext(options);
    }

    private IProjectService CreateService(ScadaDbContext dbContext)
    {
        var logger = new Mock<ILogger<ProjectService>>();
        return new ProjectService(dbContext, logger.Object);
    }

    [Fact]
    public async Task GetAllAsync_WithNoProjects_ReturnsEmptyList()
    {
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        var result = await service.GetAllAsync();

        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task CreateAsync_WithValidRequest_CreatesProject()
    {
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);
        var request = new CreateProjectRequest("Mi proyecto", "Desc", "Autor", "esp01", "contenido");

        var result = await service.CreateAsync(request);

        Assert.NotNull(result);
        Assert.Equal("Mi proyecto", result.Name);
        Assert.Equal(9, result.ContentLength);

        var persisted = await dbContext.ScadaProjects.FindAsync(result.Id);
        Assert.NotNull(persisted);
        Assert.Equal("Mi proyecto", persisted!.Name);
    }

    [Fact]
    public async Task GetContentAsync_WithExistingProject_ReturnsContent()
    {
        var dbContext = CreateDbContext();
        var project = new ScadaProject { Name = "A", Description = "B", Author = "C", Content = "texto" };
        dbContext.ScadaProjects.Add(project);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        var content = await service.GetContentAsync(project.Id);

        Assert.Equal("texto", content);
    }

    [Fact]
    public async Task GetMetaAsync_WithNonExistingProject_ReturnsNull()
    {
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        var meta = await service.GetMetaAsync(999);

        Assert.Null(meta);
    }

    [Fact]
    public async Task UpdateAsync_WithExistingProject_UpdatesProject()
    {
        var dbContext = CreateDbContext();
        var project = new ScadaProject { Name = "Old", Description = "Old Desc", Author = "A", Content = "texto" };
        dbContext.ScadaProjects.Add(project);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);
        var updateRequest = new UpdateProjectRequest("New", "New Desc", "contenido nuevo");

        var result = await service.UpdateAsync(project.Id, updateRequest);

        Assert.NotNull(result);
        Assert.Equal("New", result!.Name);
        Assert.Equal(15, result.ContentLength);
    }

    [Fact]
    public async Task DeleteAsync_WithExistingProject_ReturnsTrue()
    {
        var dbContext = CreateDbContext();
        var project = new ScadaProject { Name = "X", Description = "D", Author = "A", Content = "texto" };
        dbContext.ScadaProjects.Add(project);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        var deleted = await service.DeleteAsync(project.Id);

        Assert.True(deleted);
        Assert.Null(await dbContext.ScadaProjects.FindAsync(project.Id));
    }

    [Fact]
    public async Task GetDownloadAsync_WithExistingProject_ReturnsProjectFile()
    {
        var dbContext = CreateDbContext();
        var project = new ScadaProject { Name = "My Project", Description = "D", Author = "A", Content = "contenido" };
        dbContext.ScadaProjects.Add(project);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        var download = await service.GetDownloadAsync(project.Id);

        Assert.NotNull(download);
        Assert.Equal("My_Project.scada", download!.Filename);
        Assert.Equal(System.Text.Encoding.UTF8.GetBytes("contenido"), download.Content);
    }
}
