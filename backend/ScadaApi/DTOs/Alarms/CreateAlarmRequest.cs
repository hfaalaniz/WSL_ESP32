using System.ComponentModel.DataAnnotations;
using ScadaApi.Validation;

namespace ScadaApi.DTOs.Alarms;

/// <summary>DTO para crear una alarma con validaciones.</summary>
public record CreateAlarmRequest(
    [Required(ErrorMessage = "Message es requerido")]
    [StringLength(500, MinimumLength = 1, ErrorMessage = "Message debe tener entre 1 y 500 caracteres")]
    string Message,

    [Required(ErrorMessage = "Level es requerido")]
    string Level,

    [StringLength(100, ErrorMessage = "Tag no puede exceder 100 caracteres")]
    string? Tag
);
