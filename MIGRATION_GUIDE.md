# 🔄 Guía de Migración: Controllers usando Services

Este documento muestra cómo refactorizar los Controllers existentes para usar la nueva capa de Services.

---

## Antes: Lógica en Controller

```csharp
// ❌ DevicesController.cs - ANTIGUO
[ApiController]
[Route("api/[controller]")]
public class DevicesController : ControllerBase
{
    private readonly ScadaDbContext _db;
    
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var devices = await _db.Devices.AsNoTracking().ToListAsync();
        return Ok(devices.Select(d => new DeviceResponse(...)));
    }
    
    private bool IsOnline(Device d) { ... }  // Lógica duplicada
}
```

---

## Después: Controllers delegando a Services

```csharp
// ✅ DevicesController.cs - NUEVO
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class DevicesController : ControllerBase
{
    private readonly IDeviceService _deviceService;
    private readonly ILogger<DevicesController> _logger;

    // Inyectar el servicio
    public DevicesController(IDeviceService deviceService, ILogger<DevicesController> logger)
    {
        _deviceService = deviceService;
        _logger = logger;
    }

    /// <summary>Lista todos los dispositivos.</summary>
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
        var device = await _deviceService.GetByIdAsync(id);
        if (device is null)
        {
            _logger.LogWarning("Device {Id} not found", id);
            return NotFound();
        }
        return Ok(device);
    }

    [HttpPost]
    [ProducesResponseType<DeviceResponse>(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Create([FromBody] CreateDeviceRequest req)
    {
        try
        {
            var device = await _deviceService.CreateAsync(req);
            return CreatedAtAction(nameof(GetById), new { id = device.Id }, device);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to create device");
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpPut("{id}")]
    [ProducesResponseType<DeviceResponse>(200)]
    [ProducesResponseType(404)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateDeviceRequest req)
    {
        try
        {
            var device = await _deviceService.UpdateAsync(id, req);
            if (device is null)
                return NotFound();
            return Ok(device);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    [ProducesResponseType(204)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Delete(string id)
    {
        var success = await _deviceService.DeleteAsync(id);
        return success ? NoContent() : NotFound();
    }

    [HttpPost("{id}/ping")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Ping(string id, [FromQuery] string? ip)
    {
        var success = await _deviceService.PingAsync(id, ip);
        if (!success)
            return NotFound();
        return Ok(new { status = "ok" });
    }
}
```

---

## Patrones Clave

### 1. **Inyección de Dependencia**
```csharp
// Program.cs - ya configurado
builder.Services.AddScoped<IDeviceService, DeviceService>();

// En Controller
public DevicesController(IDeviceService deviceService, ILogger<DevicesController> logger)
{
    _deviceService = deviceService;
    _logger = logger;
}
```

### 2. **Manejo de Errores**
```csharp
try
{
    var result = await _deviceService.CreateAsync(req);
    return CreatedAtAction(...);
}
catch (InvalidOperationException ex)
{
    _logger.LogWarning(ex, "Business logic error");
    return BadRequest(new { error = ex.Message });
}
// Otros errores → Middleware global
```

### 3. **Logging**
```csharp
_logger.LogInformation("Creating device {DeviceId}", requisiteId);

// Servicio registra detalles
// Controller registra request/response
```

---

## Migración TelemetryController

```csharp
// ✅ TelemetryController - ACTUALIZADO
[ApiController]
[Route("api/devices/{deviceId}/telemetry")]
[Produces("application/json")]
public class TelemetryController : ControllerBase
{
    private readonly ITelemetryService _telemetryService;
    private readonly ILogger<TelemetryController> _logger;

    public TelemetryController(ITelemetryService telemetryService, ILogger<TelemetryController> logger)
    {
        _telemetryService = telemetryService;
        _logger = logger;
    }

    [HttpGet]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetLatest(string deviceId)
    {
        try
        {
            var values = await _telemetryService.GetLatestAsync(deviceId);
            return Ok(values);
        }
        catch (InvalidOperationException)
        {
            return NotFound();
        }
    }

    [HttpPost]
    [ProducesResponseType(204)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Push(
        string deviceId,
        [FromBody] Dictionary<string, JsonElement> payload)
    {
        try
        {
            var count = await _telemetryService.PushAsync(deviceId, payload);
            _logger.LogDebug("Pushed {Count} telemetry records", count);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(new { error = ex.Message });
        }
    }

    [HttpGet("history")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetHistory(
        string deviceId,
        [FromQuery] string tag,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] int limit = 1000)
    {
        if (string.IsNullOrWhiteSpace(tag))
            return BadRequest(new { error = "Tag is required" });

        try
        {
            var history = await _telemetryService.GetHistoryAsync(deviceId, tag, from, to, limit);
            return Ok(history);
        }
        catch (InvalidOperationException)
        {
            return NotFound();
        }
    }

    [HttpDelete("purge")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Purge(string deviceId)
    {
        try
        {
            var deleted = await _telemetryService.PurgeAsync(deviceId);
            return Ok(new { deleted, message = $"Purged {deleted} records" });
        }
        catch (InvalidOperationException)
        {
            return NotFound();
        }
    }
}
```

---

## Migración AlarmsController

```csharp
// ✅ AlarmsController - ACTUALIZADO
[ApiController]
[Route("api/devices/{deviceId}/alarms")]
[Produces("application/json")]
public class AlarmsController : ControllerBase
{
    private readonly IAlarmService _alarmService;
    private readonly ILogger<AlarmsController> _logger;

    public AlarmsController(IAlarmService alarmService, ILogger<AlarmsController> logger)
    {
        _alarmService = alarmService;
        _logger = logger;
    }

    [HttpGet]
    [ProducesResponseType<List<AlarmResponse>>(200)]
    public async Task<IActionResult> GetAll(
        string deviceId,
        [FromQuery] bool? activeOnly = null,
        [FromQuery] string? level = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] int limit = 100)
    {
        var alarms = await _alarmService.GetAllAsync(deviceId, activeOnly, level, from, to, limit);
        return Ok(alarms);
    }

    [HttpGet("summary")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Summary(string deviceId)
    {
        var summary = await _alarmService.GetSummaryAsync(deviceId);
        return Ok(summary);
    }

    [HttpPost]
    [ProducesResponseType<AlarmResponse>(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Create(
        string deviceId,
        [FromBody] CreateAlarmRequest req)
    {
        try
        {
            var alarm = await _alarmService.CreateAsync(deviceId, req);
            return CreatedAtAction(nameof(GetAll), new { deviceId }, alarm);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("{alarmId:long}/ack")]
    [ProducesResponseType<AlarmResponse>(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Acknowledge(
        string deviceId,
        long alarmId,
        [FromBody] AckRequest req)
    {
        var alarm = await _alarmService.AcknowledgeAsync(deviceId, alarmId, req.AckedBy);
        return alarm is null ? NotFound() : Ok(alarm);
    }

    [HttpPut("ack-all")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> AcknowledgeAll(
        string deviceId,
        [FromBody] AckRequest req)
    {
        var count = await _alarmService.AcknowledgeAllAsync(deviceId, req.AckedBy);
        return Ok(new { acknowledged = count });
    }
}
```

---

## Checklist de Refactoring

- [ ] Crear interfaz del servicio (`IXxxService.cs`)
- [ ] Implementar servicio (`XxxService.cs`)
- [ ] Inyectar en `Program.cs` → `builder.Services.AddScoped<>`
- [ ] Agregar inyección en Constructor del Controller
- [ ] Reemplazar lógica con llamadas a servicio
- [ ] Agregar logging en Controller (request/response)
- [ ] Agregar try-catch para errores de negocio
- [ ] Probar endpoints con Swagger UI
- [ ] Remover lógica y helpers privados del controller

---

## Ejemplo: Agregar nueva feature

### 1. Crear DTO + Validador
```csharp
// DTOs/Projects/CreateProjectRequest.cs
public record CreateProjectRequest(
    [Required] string Name,
    [StringLength(1000)] string? Description
);
```

### 2. Crear Servicio
```csharp
// Services/IProjectService.cs
public interface IProjectService
{
    Task<ProjectResponse> CreateAsync(CreateProjectRequest req);
}

// Services/ProjectService.cs
public class ProjectService : IProjectService
{
    public async Task<ProjectResponse> CreateAsync(CreateProjectRequest req)
    {
        _logger.LogInformation("Creating project {Name}", req.Name);
        // ... lógica
    }
}
```

### 3. Registrar en Program.cs
```csharp
builder.Services.AddScoped<IProjectService, ProjectService>();
```

### 4. Usar en Controller
```csharp
[HttpPost]
public async Task<IActionResult> Create([FromBody] CreateProjectRequest req)
{
    var project = await _projectService.CreateAsync(req);
    return CreatedAtAction(nameof(GetById), new { id = project.Id }, project);
}
```

---

## Beneficios de esta Arquitectura

✅ **Testeable** - Services pueden se mockeados  
✅ **Reutilizable** - Servicios en múltiples contexts  
✅ **Mantenible** - Lógica centralizada  
✅ **Observable** - Logging completo  
✅ **Escalable** - Agregar features fácilmente  
✅ **Profesional** - Arquitectura reconocida  

---

**Siguiente Paso:** Refactorizar los Controllers existentes siguiendo este patrón.
