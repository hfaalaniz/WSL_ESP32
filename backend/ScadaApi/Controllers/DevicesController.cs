using Microsoft.AspNetCore.Mvc;
using ScadaApi.DTOs.Device;
using ScadaApi.Services;

namespace ScadaApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class DevicesController : ControllerBase
{
    private readonly IDeviceService _deviceService;
    private readonly ILogger<DevicesController> _logger;

    public DevicesController(IDeviceService deviceService, ILogger<DevicesController> logger)
    {
        _deviceService = deviceService;
        _logger = logger;
    }

    /// <summary>Lista todos los dispositivos registrados.</summary>
    [HttpGet]
    [ProducesResponseType<List<DeviceResponse>>(200)]
    public async Task<IActionResult> GetAll()
    {
        _logger.LogInformation("Fetching all devices");
        var devices = await _deviceService.GetAllAsync();
        return Ok(devices);
    }

    /// <summary>Obtiene un dispositivo por ID.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType<DeviceResponse>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetById(string id)
    {
        _logger.LogInformation("Fetching device {DeviceId}", id);
        var device = await _deviceService.GetByIdAsync(id);
        if (device is null)
        {
            _logger.LogWarning("Device {DeviceId} not found", id);
            return NotFound();
        }
        return Ok(device);
    }

    /// <summary>Obtiene la sección [HARDWARE] del dispositivo.</summary>
    [HttpGet("{id}/hardware")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetHardware(string id)
    {
        var device = await _deviceService.GetByIdAsync(id);
        if (device is null)
        {
            _logger.LogWarning("Device {DeviceId} not found for hardware request", id);
            return NotFound();
        }
        
        _logger.LogInformation("Fetching hardware config for device {DeviceId}", id);
        return Ok(device);
    }

    /// <summary>
    /// Registra un nuevo dispositivo.
    /// El ESP32 puede auto-registrarse con POST al primer arranque.
    /// </summary>
    [HttpPost]
    [ProducesResponseType<DeviceResponse>(201)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Create([FromBody] CreateDeviceRequest req)
    {
        _logger.LogInformation("Creating device {DeviceId}", req.Id);
        
        try
        {
            var device = await _deviceService.CreateAsync(req);
            _logger.LogInformation("Device {DeviceId} created successfully", req.Id);
            return CreatedAtAction(nameof(GetById), new { id = device.Id }, device);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to create device {DeviceId}: {Message}", req.Id, ex.Message);
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>Actualiza los datos de un dispositivo.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType<DeviceResponse>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateDeviceRequest req)
    {
        _logger.LogInformation("Updating device {DeviceId}", id);
        
        try
        {
            var device = await _deviceService.UpdateAsync(id, req);
            if (device is null)
            {
                _logger.LogWarning("Device {DeviceId} not found for update", id);
                return NotFound();
            }
            _logger.LogInformation("Device {DeviceId} updated successfully", id);
            return Ok(device);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to update device {DeviceId}", id);
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Elimina un dispositivo y todos sus datos asociados.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(204)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Delete(string id)
    {
        _logger.LogInformation("Deleting device {DeviceId}", id);
        
        var success = await _deviceService.DeleteAsync(id);
        if (!success)
        {
            _logger.LogWarning("Device {DeviceId} not found for deletion", id);
            return NotFound();
        }
        
        _logger.LogInformation("Device {DeviceId} deleted successfully", id);
        return NoContent();
    }

    /// <summary>
    /// El ESP32 llama a este endpoint al iniciar para registrar su presencia.
    /// Si ya existe, actualiza LastSeenAt e IP.
    /// </summary>
    [HttpPost("{id}/ping")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Ping(string id, [FromQuery] string? ip)
    {
        _logger.LogDebug("Device {DeviceId} ping with IP {IpAddress}", id, ip ?? "unknown");
        
        var success = await _deviceService.PingAsync(id, ip);
        if (!success)
        {
            _logger.LogWarning("Device {DeviceId} not found for ping", id);
            return NotFound();
        }
        
        return Ok(new { status = "ok" });
    }
}
