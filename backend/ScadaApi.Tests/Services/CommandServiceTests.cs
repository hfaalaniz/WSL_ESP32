using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using ScadaApi.Data;
using ScadaApi.DTOs.Commands;
using ScadaApi.Models;
using ScadaApi.Services;

namespace ScadaApi.Tests.Services;

public class CommandServiceTests
{
    private ScadaDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ScadaDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ScadaDbContext(options);
    }

    private ICommandService CreateService(ScadaDbContext dbContext)
    {
        var logger = new Mock<ILogger<CommandService>>();
        return new CommandService(dbContext, logger.Object);
    }

    [Fact]
    public async Task GetAllAsync_WithNoCommands_ReturnsEmptyList()
    {
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        var result = await service.GetAllAsync("esp01");

        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task CreateAsync_WithMissingDevice_ReturnsNull()
    {
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);
        var request = new CreateCommandRequest("toggle", JsonDocument.Parse("true").RootElement, "UI");

        var result = await service.CreateAsync("esp01", request);

        Assert.Null(result);
    }

    [Fact]
    public async Task CreateAsync_WithValidRequest_CreatesCommand()
    {
        var dbContext = CreateDbContext();
        dbContext.Devices.Add(new Device { Id = "esp01", Name = "Device 1", IpAddress = "192.168.0.10", Port = 80 });
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);
        var request = new CreateCommandRequest("toggle", JsonDocument.Parse("true").RootElement, "UI");

        var result = await service.CreateAsync("esp01", request);

        Assert.NotNull(result);
        Assert.Equal("toggle", result!.Tag);
        Assert.Equal(true, result.Value);
        Assert.False(result.IsExecuted);

        var persisted = await dbContext.PendingCommands.FirstOrDefaultAsync();
        Assert.NotNull(persisted);
        Assert.Equal("toggle", persisted!.Tag);
    }

    [Fact]
    public async Task GetPendingAsync_UpdatesDeviceLastSeen()
    {
        var dbContext = CreateDbContext();
        dbContext.Devices.Add(new Device { Id = "esp01", Name = "Device 1", IpAddress = "192.168.0.10", Port = 80 });
        dbContext.PendingCommands.Add(new PendingCommand { DeviceId = "esp01", Tag = "cmd", Value = "true", CreatedAt = DateTime.UtcNow.AddMinutes(-5) });
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        var result = await service.GetPendingAsync("esp01");

        Assert.Single(result);
        Assert.Null(result[0].ExecutedAt);

        var device = await dbContext.Devices.FindAsync("esp01");
        Assert.NotNull(device?.LastSeenAt);
    }

    [Fact]
    public async Task MarkDoneAsync_MarksCommandExecuted()
    {
        var dbContext = CreateDbContext();
        dbContext.Devices.Add(new Device { Id = "esp01", Name = "Device 1", IpAddress = "192.168.0.10", Port = 80 });
        var command = new PendingCommand { DeviceId = "esp01", Tag = "cmd", Value = "true", CreatedAt = DateTime.UtcNow };
        dbContext.PendingCommands.Add(command);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        var result = await service.MarkDoneAsync("esp01", command.Id);

        Assert.NotNull(result);
        Assert.True(result!.IsExecuted);
        Assert.NotNull(result.ExecutedAt);
    }

    [Fact]
    public async Task PurgeAsync_RemovesOlderExecutedCommands()
    {
        var dbContext = CreateDbContext();
        dbContext.Devices.Add(new Device { Id = "esp01", Name = "Device 1", IpAddress = "192.168.0.10", Port = 80 });
        dbContext.PendingCommands.AddRange(
            new PendingCommand { DeviceId = "esp01", Tag = "cmd1", Value = "true", CreatedAt = DateTime.UtcNow.AddDays(-10), ExecutedAt = DateTime.UtcNow.AddDays(-9) },
            new PendingCommand { DeviceId = "esp01", Tag = "cmd2", Value = "false", CreatedAt = DateTime.UtcNow.AddDays(-2), ExecutedAt = DateTime.UtcNow.AddDays(-1) }
        );
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        var deleted = await service.PurgeAsync("esp01", 7);

        Assert.Equal(1, deleted);
        Assert.Single(await dbContext.PendingCommands.ToListAsync());
    }
}
