namespace ScadaApi.DTOs.Common;

/// <summary>Parámetros comunes de paginación.</summary>
public record PaginationParams(
    int Limit = 100,
    int Offset = 0
)
{
    /// <summary>Valida que los parámetros sean razonables.</summary>
    public void Validate()
    {
        if (Limit < 1 || Limit > 1000)
            throw new ArgumentException("Limit debe estar entre 1 y 1000", nameof(Limit));
        if (Offset < 0)
            throw new ArgumentException("Offset no puede ser negativo", nameof(Offset));
    }
}
