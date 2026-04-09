namespace ScadaApi.Models;

/// <summary>
/// Archivo .scada completo almacenado en la base de datos.
/// </summary>
public class ScadaProject
{
    public int      Id          { get; set; }
    public string   Name        { get; set; } = "";
    public string   Description { get; set; } = "";
    public string   Author      { get; set; } = "";

    /// <summary>ID del dispositivo al que pertenece este proyecto (opcional)</summary>
    public string?  DeviceId    { get; set; }

    /// <summary>Contenido completo del archivo .scada</summary>
    public string   Content     { get; set; } = "";

    public DateTime CreatedAt   { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt   { get; set; } = DateTime.UtcNow;
}
