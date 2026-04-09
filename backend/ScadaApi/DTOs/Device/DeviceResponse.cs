namespace ScadaApi.DTOs.Device;

/// <summary>Respuesta DTO para un dispositivo.</summary>
public record DeviceResponse(
    string Id,
    string Name,
    string Description,
    string Mode,
    string? IpAddress,
    int Port,
    bool IsOnline,
    DateTime CreatedAt,
    DateTime? LastSeenAt,
    bool HasHardwareConfig
);
