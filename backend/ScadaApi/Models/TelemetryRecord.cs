namespace ScadaApi.Models;

/// <summary>
/// Registro de un valor de tag en un instante de tiempo.
/// Índice: (DeviceId, Tag, Timestamp) para consultas eficientes.
/// </summary>
public class TelemetryRecord
{
    public long     Id        { get; set; }
    public string   DeviceId  { get; set; } = "";
    public string   Tag       { get; set; } = "";

    /// <summary>
    /// Valor almacenado como JSON string para soportar:
    /// boolean, number (double), string.
    /// Ejemplos: "true", "3.14", "\"activo\""
    /// </summary>
    public string   Value     { get; set; } = "0";

    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    // Navegación EF
    public Device?  Device    { get; set; }
}
