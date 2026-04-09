using Moq;
using ScadaApi.Data;
using ScadaApi.DTOs.Alarms;
using ScadaApi.Models;
using ScadaApi.Services;
using Xunit;
using Microsoft.EntityFrameworkCore;

namespace ScadaApi.Tests.Services;

public class AlarmServiceTests
{
    private ScadaDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ScadaDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ScadaDbContext(options);
    }

    private IAlarmService CreateService(ScadaDbContext dbContext)
    {
        var mockLogger = new Mock<ILogger<AlarmService>>();
        return new AlarmService(dbContext, mockLogger.Object);
    }

    private void SeedDevice(ScadaDbContext dbContext, string deviceId = "esp01")
    {
        var device = new Device { Id = deviceId, Name = $"Device {deviceId}", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        dbContext.SaveChanges();
    }

    #region GetAll Tests

    [Fact]
    public async Task GetAll_WithNoAlarms_ReturnsEmptyList()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);
        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync("esp01", null, null, null, null, 100);

        // Assert
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetAll_WithMultipleAlarms_ReturnsAll()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "Alarm 1", Level = "INFO", TriggeredAt = DateTime.UtcNow.AddMinutes(-5), IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Alarm 2", Level = "WARN", TriggeredAt = DateTime.UtcNow.AddMinutes(-3), IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Alarm 3", Level = "CRITICAL", TriggeredAt = DateTime.UtcNow.AddMinutes(-1), IsActive = false }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync("esp01", null, null, null, null, 100);

        // Assert
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task GetAll_WithActiveOnlyFilter_ReturnsOnlyActiveAlarms()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "Active", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Acked", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = false }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync("esp01", activeOnly: true, null, null, null, 100);

        // Assert
        Assert.Single(result);
        Assert.True(result[0].IsActive);
    }

    [Fact]
    public async Task GetAll_WithLevelFilter_ReturnsFilteredAlarms()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "Info Alarm", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Warn Alarm", Level = "WARN", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Critical Alarm", Level = "CRITICAL", TriggeredAt = DateTime.UtcNow, IsActive = true }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync("esp01", null, level: "WARN", null, null, 100);

        // Assert
        Assert.Single(result);
        Assert.Equal("WARN", result[0].Level);
    }

    [Fact]
    public async Task GetAll_WithDateRangeFilter_ReturnsFilteredAlarms()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var start = DateTime.UtcNow.AddMinutes(-10);
        var middle = DateTime.UtcNow.AddMinutes(-5);
        var end = DateTime.UtcNow;

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "Before", Level = "INFO", TriggeredAt = start, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Middle", Level = "INFO", TriggeredAt = middle, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "After", Level = "INFO", TriggeredAt = end, IsActive = true }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync("esp01", null, null, middle, end, 100);

        // Assert
        Assert.Equal(2, result.Count);
        Assert.All(result, a => Assert.True(a.TriggeredAt >= middle));
    }

    [Fact]
    public async Task GetAll_RespectLimitParameter()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = Enumerable.Range(0, 50)
            .Select(i => new AlarmRecord
            {
                DeviceId = "esp01",
                Message = $"Alarm {i}",
                Level = "INFO",
                TriggeredAt = DateTime.UtcNow.AddSeconds(-i),
                IsActive = true
            })
            .ToList();

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync("esp01", null, null, null, null, limit: 10);

        // Assert
        Assert.Equal(10, result.Count);
    }

    #endregion

    #region GetSummary Tests

    [Fact]
    public async Task GetSummary_WithMixedAlarms_ReturnsCounts()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "Info 1", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Info 2", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Warn 1", Level = "WARN", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Critical 1", Level = "CRITICAL", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "Acked Info", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = false }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetSummaryAsync("esp01");

        // Assert
        Assert.NotNull(result);
        Assert.Equal(4, result.Total);
        Assert.Equal(2, result.Info);
        Assert.Equal(1, result.Warn);
        Assert.Equal(1, result.Critical);
    }

    [Fact]
    public async Task GetSummary_WithNoActiveAlarms_ReturnsZeros()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "Acked", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = false }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetSummaryAsync("esp01");

        // Assert
        Assert.Equal(0, result.Total);
        Assert.Equal(0, result.Info);
        Assert.Equal(0, result.Warn);
        Assert.Equal(0, result.Critical);
    }

    #endregion

    #region Create Tests

    [Fact]
    public async Task Create_WithValidRequest_CreatesAlarm()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var req = new CreateAlarmRequest(
            Message: "Test Alarm",
            Level: "WARN",
            Tag: "esp01.temp"
        );

        var service = CreateService(dbContext);
        var beforeCreate = DateTime.UtcNow;

        // Act
        var result = await service.CreateAsync("esp01", req);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("Test Alarm", result.Message);
        Assert.Equal("WARN", result.Level);
        Assert.Equal("esp01.temp", result.Tag);
        Assert.True(result.IsActive);
        Assert.True(result.TriggeredAt >= beforeCreate);
        Assert.Null(result.AckedAt);
        Assert.Null(result.AckedBy);
    }

    [Fact]
    public async Task Create_WithNonExistingDevice_ThrowsException()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var req = new CreateAlarmRequest(
            Message: "Test",
            Level: "INFO",
            Tag: null
        );

        var service = CreateService(dbContext);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync("nonexistent", req));
    }

    [Fact]
    public async Task Create_NormalizesLevelToUpperCase()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var req = new CreateAlarmRequest(
            Message: "Test",
            Level: "warn",
            Tag: null
        );

        var service = CreateService(dbContext);

        // Act
        var result = await service.CreateAsync("esp01", req);

        // Assert
        Assert.Equal("WARN", result.Level);
    }

    #endregion

    #region Acknowledge Tests

    [Fact]
    public async Task Acknowledge_WithActiveAlarm_AcknowledgesSuccessfully()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarm = new AlarmRecord
        {
            DeviceId = "esp01",
            Message = "Test",
            Level = "INFO",
            TriggeredAt = DateTime.UtcNow,
            IsActive = true
        };

        dbContext.AlarmRecords.Add(alarm);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);
        var beforeAck = DateTime.UtcNow;

        // Act
        var result = await service.AcknowledgeAsync("esp01", alarm.Id, "operator1");

        // Assert
        Assert.NotNull(result);
        Assert.False(result.IsActive);
        Assert.Equal("operator1", result.AckedBy);
        Assert.NotNull(result.AckedAt);
        Assert.True(result.AckedAt >= beforeAck);
    }

    [Fact]
    public async Task Acknowledge_WithAlreadyAckedAlarm_ReturnsAlarm()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarm = new AlarmRecord
        {
            DeviceId = "esp01",
            Message = "Test",
            Level = "INFO",
            TriggeredAt = DateTime.UtcNow,
            IsActive = false,
            AckedAt = DateTime.UtcNow,
            AckedBy = "operator1"
        };

        dbContext.AlarmRecords.Add(alarm);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.AcknowledgeAsync("esp01", alarm.Id, "operator2");

        // Assert
        Assert.NotNull(result);
        Assert.False(result.IsActive);
        Assert.Equal("operator1", result.AckedBy); // Original ACK preserved
    }

    [Fact]
    public async Task Acknowledge_WithNonExistingAlarm_ReturnsNull()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        // Act
        var result = await service.AcknowledgeAsync("esp01", 999, "operator");

        // Assert
        Assert.Null(result);
    }

    #endregion

    #region AcknowledgeAll Tests

    [Fact]
    public async Task AcknowledgeAll_AcknowledgesAllActiveAlarms()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "1", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "2", Level = "WARN", TriggeredAt = DateTime.UtcNow, IsActive = true },
            new AlarmRecord { DeviceId = "esp01", Message = "3", Level = "CRITICAL", TriggeredAt = DateTime.UtcNow, IsActive = false, AckedAt = DateTime.UtcNow, AckedBy = "ops" }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var count = await service.AcknowledgeAllAsync("esp01", "operator");

        // Assert
        Assert.Equal(2, count); // Only active alarms

        var updated = dbContext.AlarmRecords.Where(a => a.DeviceId == "esp01").ToList();
        Assert.All(updated, a => Assert.False(a.IsActive));
        Assert.Equal(2, updated.Count(a => a.AckedBy == "operator"));
    }

    [Fact]
    public async Task AcknowledgeAll_WithNoActiveAlarms_ReturnsZero()
    {
        // Arrange
        var dbContext = CreateDbContext();
        SeedDevice(dbContext);

        var alarms = new[]
        {
            new AlarmRecord { DeviceId = "esp01", Message = "1", Level = "INFO", TriggeredAt = DateTime.UtcNow, IsActive = false }
        };

        dbContext.AlarmRecords.AddRange(alarms);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var count = await service.AcknowledgeAllAsync("esp01", "operator");

        // Assert
        Assert.Equal(0, count);
    }

    #endregion
}
