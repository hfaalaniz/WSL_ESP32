namespace ScadaApi.DTOs.Firmware;

public class FlashRequest
{
    public string PortName  { get; set; } = "";   // e.g. "COM3"
    public string BinPath   { get; set; } = "";   // ruta absoluta al .bin
    public int    BaudRate  { get; set; } = 921600;
    public string Chip      { get; set; } = "auto"; // auto|esp32|esp32s3...
}
