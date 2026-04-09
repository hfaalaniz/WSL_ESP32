using Microsoft.AspNetCore.Mvc;
using ScadaApi.DTOs.Commands;
using ScadaApi.Services;

namespace ScadaApi.Controllers;

/// <summary>
/// Cola de comandos frontend → ESP32.
///
/// Flujo:
///   1. Frontend POST /api/devices/{id}/commands  → encola el comando
///   2. ESP32    GET  /api/devices/{id}/commands/pending → descarga pendientes
///   3. ESP32    PUT  /api/devices/{id}/commands/{cmdId}/done → confirma ejecución
/// </summary>
[ApiController]
[Route("api/devices/{deviceId}/commands")]
[Produces("application/json")]
public class CommandsController : ControllerBase
{
    private readonly ICommandService _service;
    private readonly ILogger<CommandsController> _logger;

    public CommandsController(ICommandService service, ILogger<CommandsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    /// <summary>
    /// Lista todos los comandos (ejecutados y pendientes) del dispositivo.
    /// </summary>
    [HttpGet]
    [ProducesResponseType<List<CommandResponse>>(200)]
    public async Task<IActionResult> GetAll(
        string deviceId,
        [FromQuery] bool? pendingOnly = null,
        [FromQuery] int limit = 50)
    {
        _logger.LogInformation("Fetching commands for device {DeviceId} (pendingOnly={PendingOnly}, limit={Limit})", 
            deviceId, pendingOnly, limit);

        var commands = await _service.GetAllAsync(deviceId, pendingOnly, limit);
        return Ok(commands);
    }

    /// <summary>
    /// El ESP32 consulta este endpoint para obtener sus comandos pendientes.
    /// Retorna solo los no ejecutados, ordenados por CreatedAt ASC.
    /// Compatible con el firmware de F3.
    /// </summary>
    [HttpGet("pending")]
    [ProducesResponseType<List<CommandResponse>>(200)]
    public async Task<IActionResult> GetPending(string deviceId)
    {
        _logger.LogDebug("Device {DeviceId} polling for pending commands", deviceId);

        var commands = await _service.GetPendingAsync(deviceId);
        _logger.LogDebug("Device {DeviceId} has {CommandsCount} pending commands", deviceId, commands.Count);
        return Ok(commands);
    }

    /// <summary>
    /// Frontend envía un nuevo comando al ESP32.
    /// El valor puede ser boolean, número o string.
    /// </summary>
    [HttpPost]
    [ProducesResponseType<CommandResponse>(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Create(
        string deviceId,
        [FromBody] CreateCommandRequest req)
    {
        _logger.LogInformation("Creating command for device {DeviceId}: {Tag} = {Value}", 
            deviceId, req.Tag, req.Value.GetRawText());

        try
        {
            var created = await _service.CreateAsync(deviceId, req);
            if (created is null)
            {
                _logger.LogWarning("Device {DeviceId} not found for command creation", deviceId);
                return NotFound();
            }

            _logger.LogInformation("Command created for {DeviceId}", deviceId);
            return CreatedAtAction(nameof(GetAll), new { deviceId }, created);
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Command creation failed for device {DeviceId}", deviceId);
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// El ESP32 confirma que ejecutó un comando.
    /// </summary>
    [HttpPut("{id}/done")]
    [ProducesResponseType<CommandResponse>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> MarkDone(string deviceId, long id)
    {
        _logger.LogInformation("Marking command {CommandId} as done for device {DeviceId}", id, deviceId);

        var result = await _service.MarkDoneAsync(deviceId, id);
        if (result is null)
        {
            _logger.LogWarning("Command {CommandId} not found for device {DeviceId}", id, deviceId);
            return NotFound();
        }

        _logger.LogInformation("Command {CommandId} execution confirmed", id);
        return Ok(result);
    }

    /// <summary>
    /// Elimina comandos ejecutados más viejos que N días.
    /// </summary>
    [HttpDelete("purge")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Purge(string deviceId, [FromQuery] int days = 7)
    {
        _logger.LogWarning("Purging commands for device {DeviceId} older than {Days} days", deviceId, days);

        var deleted = await _service.PurgeAsync(deviceId, days);
        _logger.LogInformation("Purged {DeletedCount} commands for device {DeviceId}", deleted, deviceId);
        return Ok(new { deleted });
    }
}
