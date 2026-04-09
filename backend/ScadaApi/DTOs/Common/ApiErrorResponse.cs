namespace ScadaApi.DTOs.Common;

/// <summary>Respuesta estándar de error API.</summary>
public record ApiErrorResponse(
    int StatusCode,
    string Message,
    string? Details = null,
    Dictionary<string, string[]>? Errors = null
);
