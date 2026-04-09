using Moq;
using ScadaApi.Data;
using ScadaApi.DTOs.Device;
using ScadaApi.Models;
using ScadaApi.Services;
using Xunit;
using Microsoft.EntityFrameworkCore;

namespace ScadaApi.Tests.Services;

public class DeviceServiceTests
{
    private ScadaDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ScadaDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        return new ScadaDbContext(options);
    }

    private IDeviceService CreateService(ScadaDbContext dbContext)
    {
        var mockLogger = new Mock<ILogger<DeviceService>>();
        var mockConfig = new Mock<IConfiguration>();
        
        // Mock IConfigurationSection for GetSection
        var section = new Mock<IConfigurationSection>();
        section.Setup(s => s.Value).Returns("30");
        mockConfig.Setup(c => c.GetSection(It.IsAny<string>())).Returns(section.Object);
        
        // For direct indexer access (if needed)
        mockConfig.Setup(c => c[It.IsAny<string>()]).Returns("30");

        return new DeviceService(dbContext, mockConfig.Object, mockLogger.Object);
    }

    #region GetAll Tests

    [Fact]
    public async Task GetAll_WithNoDevices_ReturnsEmptyList()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync();

        // Assert
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetAll_WithMultipleDevices_ReturnsAllDevices()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device1 = new Device { Id = "esp01", Name = "Device 1", IpAddress = "192.168.1.100", Port = 80 };
        var device2 = new Device { Id = "esp02", Name = "Device 2", IpAddress = "192.168.1.101", Port = 80 };

        dbContext.Devices.AddRange(device1, device2);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetAllAsync();

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.Count);
        Assert.Contains(result, d => d.Id == "esp01");
        Assert.Contains(result, d => d.Id == "esp02");
    }

    #endregion

    #region GetById Tests

    [Fact]
    public async Task GetById_WithExistingDevice_ReturnsDevice()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device { Id = "esp01", Name = "Test Device", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetByIdAsync("esp01");

        // Assert
        Assert.NotNull(result);
        Assert.Equal("esp01", result.Id);
        Assert.Equal("Test Device", result.Name);
    }

    [Fact]
    public async Task GetById_WithNonExistingDevice_ReturnsNull()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        // Act
        var result = await service.GetByIdAsync("nonexistent");

        // Assert
        Assert.Null(result);
    }

    #endregion

    #region Create Tests

    [Fact]
    public async Task Create_WithValidRequest_CreatesDevice()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var req = new CreateDeviceRequest(
            Id: "esp01",
            Name: "New Device",
            Description: "A test device",
            Mode: "AUTO",
            IpAddress: "192.168.1.100",
            Port: 80,
            HardwareConfig: null
        );

        var service = CreateService(dbContext);

        // Act
        var result = await service.CreateAsync(req);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("esp01", result.Id);
        Assert.Equal("New Device", result.Name);
        Assert.False(result.IsOnline);

        // Verify in database
        var device = await dbContext.Devices.FindAsync("esp01");
        Assert.NotNull(device);
        Assert.Equal("New Device", device.Name);
    }

    [Fact]
    public async Task Create_WithDuplicateId_ThrowsException()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device { Id = "esp01", Name = "Existing", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var req = new CreateDeviceRequest(
            Id: "esp01",
            Name: "New Device",
            Description: null,
            Mode: null,
            IpAddress: "192.168.1.101",
            Port: null,
            HardwareConfig: null
        );

        var service = CreateService(dbContext);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(req));
    }

    [Fact]
    public async Task Create_WithMissingName_ThrowsException()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var req = new CreateDeviceRequest(
            Id: "esp01",
            Name: "",
            Description: null,
            Mode: null,
            IpAddress: "192.168.1.100",
            Port: null,
            HardwareConfig: null
        );

        var service = CreateService(dbContext);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(req));
    }

    #endregion

    #region Update Tests

    [Fact]
    public async Task Update_WithExistingDevice_UpdatesSuccessfully()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device { Id = "esp01", Name = "Old Name", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var req = new UpdateDeviceRequest(
            Name: "New Name",
            Description: "Updated description",
            Mode: null,
            IpAddress: null,
            Port: null,
            HardwareConfig: null
        );

        var service = CreateService(dbContext);

        // Act
        var result = await service.UpdateAsync("esp01", req);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("New Name", result.Name);
        Assert.Equal("Updated description", result.Description);

        // Verify in database
        var updated = await dbContext.Devices.FindAsync("esp01");
        Assert.Equal("New Name", updated!.Name);
    }

    [Fact]
    public async Task Update_WithNonExistingDevice_ReturnsNull()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var req = new UpdateDeviceRequest(
            Name: "New Name",
            Description: null,
            Mode: null,
            IpAddress: null,
            Port: null,
            HardwareConfig: null
        );

        var service = CreateService(dbContext);

        // Act
        var result = await service.UpdateAsync("nonexistent", req);

        // Assert
        Assert.Null(result);
    }

    #endregion

    #region Delete Tests

    [Fact]
    public async Task Delete_WithExistingDevice_DeletesSuccessfully()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device { Id = "esp01", Name = "Test", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.DeleteAsync("esp01");

        // Assert
        Assert.True(result);

        // Verify not in database
        var deleted = await dbContext.Devices.FindAsync("esp01");
        Assert.Null(deleted);
    }

    [Fact]
    public async Task Delete_WithNonExistingDevice_ReturnsFalse()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        // Act
        var result = await service.DeleteAsync("nonexistent");

        // Assert
        Assert.False(result);
    }

    #endregion

    #region Ping Tests

    [Fact]
    public async Task Ping_WithExistingDevice_UpdatesLastSeenAt()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device { Id = "esp01", Name = "Test", IpAddress = "192.168.1.100", Port = 80, LastSeenAt = null };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);
        var beforePing = DateTime.UtcNow;

        // Act
        var result = await service.PingAsync("esp01", "192.168.1.101");

        // Assert
        Assert.True(result);

        var updated = await dbContext.Devices.FindAsync("esp01");
        Assert.NotNull(updated!.LastSeenAt);
        Assert.True(updated.LastSeenAt >= beforePing);
        Assert.Equal("192.168.1.101", updated.IpAddress);
    }

    [Fact]
    public async Task Ping_WithNonExistingDevice_ReturnsFalse()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var service = CreateService(dbContext);

        // Act
        var result = await service.PingAsync("nonexistent", null);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public async Task Ping_WithNullIp_DoesNotUpdateIpAddress()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device { Id = "esp01", Name = "Test", IpAddress = "192.168.1.100", Port = 80 };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        await service.PingAsync("esp01", null);

        // Assert
        var updated = await dbContext.Devices.FindAsync("esp01");
        Assert.Equal("192.168.1.100", updated!.IpAddress);
    }

    #endregion

    #region IsOnline Tests

    [Fact]
    public async Task GetById_WithRecentPing_ReturnsOnlineTrue()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device
        {
            Id = "esp01",
            Name = "Test",
            IpAddress = "192.168.1.100",
            Port = 80,
            LastSeenAt = DateTime.UtcNow.AddSeconds(-5) // 5 seconds ago
        };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetByIdAsync("esp01");

        // Assert
        Assert.True(result!.IsOnline);
    }

    [Fact]
    public async Task GetById_WithOldPing_ReturnsOnlineFalse()
    {
        // Arrange
        var dbContext = CreateDbContext();
        var device = new Device
        {
            Id = "esp01",
            Name = "Test",
            IpAddress = "192.168.1.100",
            Port = 80,
            LastSeenAt = DateTime.UtcNow.AddSeconds(-60) // 60 seconds ago
        };
        dbContext.Devices.Add(device);
        await dbContext.SaveChangesAsync();

        var service = CreateService(dbContext);

        // Act
        var result = await service.GetByIdAsync("esp01");

        // Assert
        Assert.False(result!.IsOnline);
    }

    #endregion
}
