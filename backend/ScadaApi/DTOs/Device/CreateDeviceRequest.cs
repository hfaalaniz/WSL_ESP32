using System.ComponentModel.DataAnnotations;

namespace ScadaApi.DTOs.Device;

/// <summary>DTO para crear un nuevo dispositivo con validaciones.</summary>
public record CreateDeviceRequest(
    [Required(ErrorMessage = "Device ID es requerido")]
    string Id,

    [Required(ErrorMessage = "Nombre es requerido")]
    [StringLength(100, MinimumLength = 1, ErrorMessage = "Nombre debe tener entre 1 y 100 caracteres")]
    string Name,

    [StringLength(500, ErrorMessage = "Descripción no puede exceder 500 caracteres")]
    string? Description,

    [RegularExpression("LOCAL|REMOTE|AUTO", ErrorMessage = "Modo debe ser LOCAL, REMOTE o AUTO")]
    string? Mode,

    string? IpAddress,

    [Range(1, 65535, ErrorMessage = "Puerto debe estar entre 1 y 65535")]
    int? Port,

    [StringLength(50000, ErrorMessage = "Hardware config no puede exceder 50KB")]
    string? HardwareConfig
);

