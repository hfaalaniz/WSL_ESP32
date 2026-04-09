using Moq;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using ScadaApi.Data;
using ScadaApi.Models;
using ScadaApi.Services;
using Xunit;

namespace ScadaApi.Tests.Services;

public class TelemetryServiceTests
{
    private ScadaDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ScadaDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ScadaDbContext(options);
    }

    private IConfiguration CreateConfiguration(Dictionary<string, string>? overrides = null)
    {
        var configurationValues = new Dictionary<string, string?>
        {
            ["Telemetry:MaxRecordsPerQuery"] = "5000",
            ["Telemetry:RetentionDays"] = "30"
        };

        if (overrides is not null)
        {
            foreach (var kv in overrides)
                configurationValues[kv.Key] = kv.Value;
        }

        return new ConfigurationBuilder().AddInMemoryCollection(configurationValues).Build();
    }

    private ITelemetryService CreateService(ScadaDbContext dbContext, IConfiguration? configuration = null)
    {
        var mockLogger = new Mock<ILogger<TelemetryService>>();
        var config = configuration ?? CreateConfiguration();
        return new TelemetryService(dbContext, config, mockLogger.Object);
    }

    private void SeedDevice(ScadaDbContext dbContext, string deviceId = "esp01")
    {
        var device = new Device { Id = deviceId, Name = $"Device {deviceId}", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        dbContext.SaveChanges();
    }

    #region GetLatest Tests

    [Fact]
    public async Task GetLatest_WithNoRecords_ReturnsEmptyDictionary()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);
        var service = CreateService(dbContext);

        // Act
        var result = await service.GetLatestAsync("esp01");

        // Assert
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLatest_WithRecords_ReturnsLatestValues()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var records = new[]
        {
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.din.gpio4", Value = "true", Timestamp = DateTime.UtcNow.AddSeconds(-10) },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.din.gpio4", Value = "false", Timestamp = DateTime.UtcNow.AddSeconds(-5) },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.ain.adc32", Value = "1234.5", Timestamp = DateTime.UtcNow }
        };

        dbContext.TelemetryRecords.AddRange(records);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetLatestAsync("esp01");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.Count);
        Assert.True(result.ContainsKey("esp01.din.gpio4"));
        Assert.True(result.ContainsKey("esp01.ain.adc32"));
        Assert.Equal(false, result["esp01.din.gpio4"]); // Latest value
        Assert.Equal(1234.5, result["esp01.ain.adc32"]);
    }

    [Fact]
    public async Task GetLatest_WithNonExistingDevice_ThrowsException()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.GetLatestAsync("nonexistent"));
    }

    #endregion

    #region Push Tests

    [Fact]
    public async Task Push_WithValidPayload_CreatesTelemetryRecords()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);
        
        var payload = new Dictionary<string, JsonElement>
        {
            { "esp01.din.gpio4", JsonSerializer.SerializeToElement(true) },
            { "esp01.ain.adc32", JsonSerializer.SerializeToElement(1234.5) }
        };

        var service = CreateService(dbContext);
        var beforePush = DateTime.UtcNow;

        // Act
        var count = await service.PushAsync("esp01", payload);

        // Assert
        Assert.Equal(2, count);

        // Verify in database
        var records = dbContext.TelemetryRecords.Where(t => t.DeviceId == "esp01").ToList();
        Assert.Equal(2, records.Count);
        Assert.True(records[0].Timestamp >= beforePush);

        // Verify device LastSeenAt updated
        var device = await dbContext.Devices.FindAsync("esp01");
        Assert.NotNull(device!.LastSeenAt);
        Assert.True(device.LastSeenAt >= beforePush);
    }

    [Fact]
    public async Task Push_WithEmptyPayload_ThrowsException()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);
        var service = CreateService(dbContext);
        var payload = new Dictionary<string, JsonElement>();

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.PushAsync("esp01", payload));
    }

    [Fact]
    public async Task Push_WithNonExistingDevice_ThrowsException()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);
        var payload = new Dictionary<string, JsonElement>
        {
            { "esp01.din.gpio4", JsonSerializer.SerializeToElement(true) }
        };

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.PushAsync("nonexistent", payload));
    }

    [Fact]
    public async Task Push_FiltersByDevicePrefix()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext, "esp01");
        
        var payload = new Dictionary<string, JsonElement>
        {
            { "esp01.din.gpio4", JsonSerializer.SerializeToElement(true) },
            { "esp02.ain.adc32", JsonSerializer.SerializeToElement(500) }, // Wrong device
            { "esp01.dout.relay1", JsonSerializer.SerializeToElement(false) }
        };

        var service = CreateService(dbContext);

        // Act
        var count = await service.PushAsync("esp01", payload);

        // Assert
        Assert.Equal(2, count); // Only esp01 records

        var records = dbContext.TelemetryRecords.Where(t => t.DeviceId == "esp01").ToList();
        Assert.Equal(2, records.Count);
        Assert.All(records, r => Assert.StartsWith("esp01.", r.Tag));
    }

    #endregion

    #region GetHistory Tests

    [Fact]
    public async Task GetHistory_WithValidTag_ReturnsHistoryPoints()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var now = DateTime.UtcNow;
        var records = new[]
        {
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.ain.adc32", Value = "100", Timestamp = now.AddMinutes(-10) },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.ain.adc32", Value = "200", Timestamp = now.AddMinutes(-5) },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.ain.adc32", Value = "300", Timestamp = now }
        };

        dbContext.TelemetryRecords.AddRange(records);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetHistoryAsync("esp01", "esp01.ain.adc32", null, null, 1000);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(3, result.Count);
        Assert.Equal(100.0, result[0].Value);
        Assert.Equal(300.0, result[2].Value); // Latest
    }

    [Fact]
    public async Task GetHistory_WithDateRange_FiltersCorrectly()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var start = DateTime.UtcNow.AddMinutes(-10);
        var middle = DateTime.UtcNow.AddMinutes(-5);
        var end = DateTime.UtcNow;

        var records = new[]
        {
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.temp", Value = "20", Timestamp = start },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.temp", Value = "25", Timestamp = middle },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.temp", Value = "30", Timestamp = end }
        };

        dbContext.TelemetryRecords.AddRange(records);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetHistoryAsync("esp01", "esp01.temp", middle, end, 1000);

        // Assert
        Assert.Equal(2, result.Count);
        Assert.All(result, r => Assert.True(r.Timestamp >= middle && r.Timestamp <= end));
    }

    [Fact]
    public async Task GetHistory_WithLimit_RespectsMaximum()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var baseTime = DateTime.UtcNow.AddSeconds(-100);
        var records = Enumerable.Range(0, 100)
            .Select(i => new TelemetryRecord
            {
                DeviceId = "esp01",
                Tag = "esp01.counter",
                Value = i.ToString(),
                Timestamp = baseTime.AddSeconds(i)
            })
            .ToList();

        dbContext.TelemetryRecords.AddRange(records);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetHistoryAsync("esp01", "esp01.counter", null, null, limit: 50);

        // Assert
        Assert.Equal(50, result.Count);
    }

    [Fact]
    public async Task GetHistory_WithNonExistingTag_ReturnsEmptyList()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);
        var service = CreateService(dbContext);

        // Act
        var result = await service.GetHistoryAsync("esp01", "nonexistent.tag", null, null, 1000);

        // Assert
        Assert.Empty(result);
    }

    #endregion

    #region Purge Tests

    [Fact]
    public async Task Purge_RemovesOldRecords()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var oldTime = DateTime.UtcNow.AddDays(-40);
        var recentTime = DateTime.UtcNow.AddDays(-5);

        var records = new[]
        {
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.tag1", Value = "old", Timestamp = oldTime },
            new TelemetryRecord { DeviceId = "esp01", Tag = "esp01.tag2", Value = "recent", Timestamp = recentTime }
        };

        dbContext.TelemetryRecords.AddRange(records);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var deleted = await service.PurgeAsync("esp01");

        // Assert
        Assert.Equal(1, deleted);

        var remaining = dbContext.TelemetryRecords.Where(t => t.DeviceId == "esp01").ToList();
        Assert.Single(remaining);
        Assert.Equal("recent", remaining[0].Value);
    }

    #endregion
}
