using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using ScadaApi.Controllers;
using ScadaApi.DTOs.Commands;
using ScadaApi.Services;

namespace ScadaApi.Tests.Controllers;

public class CommandsControllerTests
{
    private CommandsController CreateController(Mock<ICommandService> serviceMock)
    {
        var logger = new Mock<ILogger<CommandsController>>();
        return new CommandsController(serviceMock.Object, logger.Object);
    }

    [Fact]
    public async Task GetAll_ReturnsOkWithCommands()
    {
        var response = new CommandResponse(1, "cmd", true, "UI", DateTime.UtcNow, null, false);
        var serviceMock = new Mock<ICommandService>();
        serviceMock.Setup(s => s.GetAllAsync("esp01", null, 50)).ReturnsAsync(new List<CommandResponse> { response });

        var controller = CreateController(serviceMock);

        var result = await controller.GetAll("esp01");

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsType<List<CommandResponse>>(ok.Value);
        Assert.Single(list);
        Assert.Equal("cmd", list[0].Tag);
    }

    [Fact]
    public async Task Create_ReturnsCreatedWhenCommandIsCreated()
    {
        var request = new CreateCommandRequest("cmd", JsonDocument.Parse("true").RootElement, "UI");
        var created = new CommandResponse(1, "cmd", true, "UI", DateTime.UtcNow, null, false);

        var serviceMock = new Mock<ICommandService>();
        serviceMock.Setup(s => s.CreateAsync("esp01", request)).ReturnsAsync(created);

        var controller = CreateController(serviceMock);

        var result = await controller.Create("esp01", request);

        var createdResult = Assert.IsType<CreatedAtActionResult>(result);
        var value = Assert.IsType<CommandResponse>(createdResult.Value);
        Assert.Equal(1, value.Id);
    }

    [Fact]
    public async Task Create_ReturnsNotFoundWhenDeviceMissing()
    {
        var request = new CreateCommandRequest("cmd", JsonDocument.Parse("true").RootElement, "UI");
        var serviceMock = new Mock<ICommandService>();
        serviceMock.Setup(s => s.CreateAsync("esp01", request)).ReturnsAsync((CommandResponse?)null);

        var controller = CreateController(serviceMock);

        var result = await controller.Create("esp01", request);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Purge_ReturnsOkWithDeletedCount()
    {
        var serviceMock = new Mock<ICommandService>();
        serviceMock.Setup(s => s.PurgeAsync("esp01", 7)).ReturnsAsync(3);
        var controller = CreateController(serviceMock);

        var result = await controller.Purge("esp01", 7);

        var ok = Assert.IsType<OkObjectResult>(result);
        var deletedProperty = ok.Value?.GetType().GetProperty("deleted");
        Assert.NotNull(deletedProperty);
        Assert.Equal(3, deletedProperty!.GetValue(ok.Value));
    }
}
