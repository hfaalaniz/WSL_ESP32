namespace ScadaApi.DTOs.Device;

/// <summary>DTO para actualizar un dispositivo existente.</summary>
public record UpdateDeviceRequest(
    string? Name,
    string? Description,
    string? Mode,
    string? IpAddress,
    int? Port,
    string? HardwareConfig
);
