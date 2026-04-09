using ScadaApi.DTOs.Device;
using ScadaApi.Models;

namespace ScadaApi.Services;

public interface IDeviceService
{
    Task<List<DeviceResponse>> GetAllAsync();
    Task<DeviceResponse?> GetByIdAsync(string id);
    Task<DeviceResponse> CreateAsync(CreateDeviceRequest req);
    Task<DeviceResponse?> UpdateAsync(string id, UpdateDeviceRequest req);
    Task<bool> DeleteAsync(string id);
    Task<bool> PingAsync(string id, string? ip);
}
