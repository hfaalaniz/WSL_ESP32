using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using ScadaApi.Controllers;
using ScadaApi.DTOs.Projects;
using ScadaApi.Services;

namespace ScadaApi.Tests.Controllers;

public class ProjectsControllerTests
{
    private ProjectsController CreateController(Mock<IProjectService> serviceMock)
    {
        var logger = new Mock<ILogger<ProjectsController>>();
        return new ProjectsController(serviceMock.Object, logger.Object);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithProjects()
    {
        var serviceMock = new Mock<IProjectService>();
        serviceMock.Setup(s => s.GetAllAsync(null)).ReturnsAsync(new List<ProjectSummary>
        {
            new(1, "P1", "Desc", "Author", null, 10, DateTime.UtcNow, DateTime.UtcNow)
        });

        var controller = CreateController(serviceMock);

        var result = await controller.GetAll();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsType<List<ProjectSummary>>(ok.Value);
        Assert.Single(list);
        Assert.Equal("P1", list[0].Name);
    }

    [Fact]
    public async Task GetContent_ReturnsPlainTextContent()
    {
        var serviceMock = new Mock<IProjectService>();
        serviceMock.Setup(s => s.GetContentAsync(1)).ReturnsAsync("contenido");

        var controller = CreateController(serviceMock);

        var result = await controller.GetContent(1);

        var content = Assert.IsType<ContentResult>(result);
        Assert.Equal("contenido", content.Content);
        Assert.Equal("text/plain; charset=utf-8", content.ContentType);
    }

    [Fact]
    public async Task GetMeta_ReturnsNotFoundWhenMissing()
    {
        var serviceMock = new Mock<IProjectService>();
        serviceMock.Setup(s => s.GetMetaAsync(1)).ReturnsAsync((ProjectSummary?)null);

        var controller = CreateController(serviceMock);

        var result = await controller.GetMeta(1);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Create_ReturnsCreatedAtAction()
    {
        var request = new CreateProjectRequest("P1", "Desc", "Author", null, "contenido");
        var created = new ProjectSummary(1, "P1", "Desc", "Author", null, 8, DateTime.UtcNow, DateTime.UtcNow);

        var serviceMock = new Mock<IProjectService>();
        serviceMock.Setup(s => s.CreateAsync(request)).ReturnsAsync(created);

        var controller = CreateController(serviceMock);

        var result = await controller.Create(request);

        var createdResult = Assert.IsType<CreatedAtActionResult>(result);
        var value = Assert.IsType<ProjectSummary>(createdResult.Value);
        Assert.Equal(1, value.Id);
    }

    [Fact]
    public async Task Delete_ReturnsNoContentWhenDeleted()
    {
        var serviceMock = new Mock<IProjectService>();
        serviceMock.Setup(s => s.DeleteAsync(1)).ReturnsAsync(true);

        var controller = CreateController(serviceMock);

        var result = await controller.Delete(1);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task Download_ReturnsFileResult()
    {
        var download = new ProjectDownload("project.scada", System.Text.Encoding.UTF8.GetBytes("contenido"));
        var serviceMock = new Mock<IProjectService>();
        serviceMock.Setup(s => s.GetDownloadAsync(1)).ReturnsAsync(download);

        var controller = CreateController(serviceMock);

        var result = await controller.Download(1);

        var fileResult = Assert.IsType<FileContentResult>(result);
        Assert.Equal("text/plain; charset=utf-8", fileResult.ContentType);
        Assert.Equal("project.scada", fileResult.FileDownloadName);
    }
}
