namespace ScadaApi.DTOs.Firmware;

public class CompilationResult
{
    public bool Success { get; set; }
    public string? Binary { get; set; }
    public string Logs { get; set; } = "";
    public string? Error { get; set; }
    /// <summary>Ruta absoluta del .bin guardado en la carpeta Proyectos/</summary>
    public string? BinPath { get; set; }
}
