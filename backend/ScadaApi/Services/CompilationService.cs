using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using ScadaApi.DTOs.Firmware;

namespace ScadaApi.Services;

public class CompilationService : ICompilationService
{
    private readonly ILogger<CompilationService> _logger;
    private readonly string _arduinoCliPath = @"C:\Users\Fabian\AppData\Local\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe";

    // Carpeta donde se guardan los .bin compilados (relativa a la raíz del repo)
    private static readonly string _proyectosDir = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, @"..\..\..\..\..\..\Proyectos"));

    public CompilationService(ILogger<CompilationService> logger)
    {
        _logger = logger;
    }

    public async Task<CompilationResult> CompileAsync(CompileRequest request)
    {
        var result = new CompilationResult { Success = false, Logs = "" };

        try
        {
            // Validar que arduino-cli existe
            if (!File.Exists(_arduinoCliPath))
            {
                result.Error = $"arduino-cli no encontrado en: {_arduinoCliPath}";
                _logger.LogError(result.Error);
                return result;
            }

            _logger.LogInformation("arduino-cli encontrado en: {Path}", _arduinoCliPath);

            // Sanitizar nombre del proyecto (solo caracteres alfanuméricos, guión, guión bajo)
            var safeProjectName = System.Text.RegularExpressions.Regex.Replace(
                request.ProjectName, @"[^a-zA-Z0-9_\-]", "_");

            // Crear directorio temporal para compilación
            // El nombre del directorio debe coincidir con el nombre del archivo .ino para arduino-cli
            var buildDir = Path.Combine(Path.GetTempPath(), "scada-build", safeProjectName);
            var srcDir = Path.Combine(Path.GetTempPath(), "scada-src", safeProjectName);
            Directory.CreateDirectory(buildDir);
            Directory.CreateDirectory(srcDir);

            _logger.LogInformation("Directorios: src={SrcDir}, build={BuildDir}", srcDir, buildDir);

            // Guardar código fuente con el nombre designado por el usuario
            var sketchPath = Path.Combine(srcDir, $"{safeProjectName}.ino");
            await File.WriteAllTextAsync(sketchPath, request.Code, Encoding.UTF8);
            _logger.LogInformation("Código guardado en: {SketchPath}", sketchPath);

            // Ejecutar arduino-cli compile
            var arguments = $"compile --fqbn {request.BoardId} --build-path \"{buildDir}\" \"{srcDir}\"";
            _logger.LogInformation("Ejecutando: {ExePath} {Args}", _arduinoCliPath, arguments);

            var psi = new ProcessStartInfo
            {
                FileName = _arduinoCliPath,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using (var process = Process.Start(psi))
            {
                if (process == null)
                {
                    result.Error = "No se pudo iniciar arduino-cli";
                    _logger.LogError(result.Error);
                    return result;
                }

                // Leer streams sin deadlock: usar ReadToEndAsync en paralelo
                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();

                // Esperar con timeout (600 segundos = 10 minutos)
                // La primera compilación ESP32 puede tardar 3-5 min compilando librerías
                if (!process.WaitForExit(600000))
                {
                    process.Kill();
                    result.Error = "Compilación timeout (10 minutos). Verifica que arduino-cli y el core esp32 estén instalados correctamente.";
                    _logger.LogError(result.Error);
                    return result;
                }

                var stdout = await stdoutTask;
                var stderr = await stderrTask;
                result.Logs = $"{stdout}\n{stderr}".Trim();

                _logger.LogInformation("arduino-cli exit code: {ExitCode}", process.ExitCode);

                if (process.ExitCode != 0)
                {
                    result.Error = $"Compilación fallida (exit code {process.ExitCode})";
                    _logger.LogError("Compilación fallida. Logs:\n{Logs}", result.Logs);
                    return result;
                }
            }

            // Buscar el binario compilado (.bin)
            var binFiles = Directory.GetFiles(buildDir, "*.bin", SearchOption.AllDirectories);
            _logger.LogInformation("Binarios encontrados: {Count}", binFiles.Length);

            var binPath = binFiles.FirstOrDefault();
            if (binPath == null)
            {
                result.Error = "No se encontró el archivo .bin compilado";
                _logger.LogError(result.Error);
                return result;
            }

            _logger.LogInformation("Binario encontrado: {BinPath}", binPath);

            // Leer binario y convertir a base64
            var binData = await File.ReadAllBytesAsync(binPath);
            result.Binary = Convert.ToBase64String(binData);
            result.Success = true;

            // Guardar .bin en carpeta Proyectos/
            var savedBinPath = await SaveBinAsync(binData, safeProjectName);
            result.BinPath = savedBinPath;

            _logger.LogInformation("Compilación exitosa: {BinSize} bytes → {BinPath}", binData.Length, savedBinPath);
        }
        catch (Exception ex)
        {
            result.Error = ex.Message;
            result.Logs += $"\nExcepción: {ex}";
            _logger.LogError(ex, "Error en compilación");
        }

        return result;
    }

    public async IAsyncEnumerable<string> CompileStreamAsync(
        CompileRequest request,
        [EnumeratorCancellation] CancellationToken ct)
    {
        if (!File.Exists(_arduinoCliPath))
        {
            yield return $"ERROR: arduino-cli no encontrado en: {_arduinoCliPath}";
            yield return "RESULT:{\"success\":false,\"error\":\"arduino-cli no encontrado\"}";
            yield break;
        }

        var safeProjectName = System.Text.RegularExpressions.Regex.Replace(
            request.ProjectName, @"[^a-zA-Z0-9_\-]", "_");

        var buildDir = Path.Combine(Path.GetTempPath(), "scada-build", safeProjectName);
        var srcDir   = Path.Combine(Path.GetTempPath(), "scada-src",   safeProjectName);
        Directory.CreateDirectory(buildDir);
        Directory.CreateDirectory(srcDir);

        var sketchPath = Path.Combine(srcDir, $"{safeProjectName}.ino");
        await File.WriteAllTextAsync(sketchPath, request.Code, Encoding.UTF8, ct);

        yield return $"LOG: Código guardado → {sketchPath}";
        yield return $"LOG: Iniciando arduino-cli compile para {request.BoardId}...";

        var arguments = $"compile --fqbn {request.BoardId} --build-path \"{buildDir}\" \"{srcDir}\"";

        var psi = new ProcessStartInfo
        {
            FileName               = _arduinoCliPath,
            Arguments              = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
            UseShellExecute        = false,
            CreateNoWindow         = true,
        };

        Process? process;
        string? startError = null;
        try { process = Process.Start(psi); }
        catch (Exception ex) { process = null; startError = ex.Message; }

        if (startError != null)
        {
            yield return $"ERROR: No se pudo iniciar arduino-cli: {startError}";
            yield return $"RESULT:{{\"success\":false,\"error\":\"{EscapeJson(startError)}\"}}";
            yield break;
        }

        if (process == null)
        {
            yield return "ERROR: Process.Start devolvió null";
            yield return "RESULT:{\"success\":false,\"error\":\"No se pudo iniciar el proceso\"}";
            yield break;
        }

        // Leer stdout y stderr combinados en tiempo real usando DataReceived
        var logChannel = System.Threading.Channels.Channel.CreateUnbounded<string?>();

        process.OutputDataReceived += (_, e) => logChannel.Writer.TryWrite(e.Data);
        process.ErrorDataReceived  += (_, e) => logChannel.Writer.TryWrite(e.Data);
        process.Exited             += (_, _) => logChannel.Writer.TryComplete();
        process.EnableRaisingEvents = true;

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // Timeout de 10 minutos
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        using var linked     = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        // Recopilar logs del proceso en un segundo canal para poder hacer yield fuera del try/catch
        var outputChannel = System.Threading.Channels.Channel.CreateUnbounded<string>();

        // Tarea que lee del logChannel y reescribe en outputChannel, capturando timeout
        var readerTask = Task.Run(async () =>
        {
            bool timedOut = false;
            try
            {
                await foreach (var line in logChannel.Reader.ReadAllAsync(linked.Token))
                {
                    if (line != null)
                        await outputChannel.Writer.WriteAsync($"LOG: {line}", CancellationToken.None);
                }
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                timedOut = true;
                try { process.Kill(entireProcessTree: true); } catch { /* ignore */ }
            }
            outputChannel.Writer.TryComplete(timedOut
                ? new TimeoutException("Timeout 10 minutos")
                : null);
        });

        // Hacer yield de cada línea en tiempo real (fuera de try/catch)
        bool hasTimeout = false;
        await foreach (var outputLine in outputChannel.Reader.ReadAllAsync(CancellationToken.None))
        {
            yield return outputLine;
        }

        await readerTask;

        // Verificar si hubo timeout (el canal se completó con excepción)
        try
        {
            outputChannel.Reader.Completion.Wait(0);
        }
        catch (AggregateException ae) when (ae.InnerException is TimeoutException)
        {
            hasTimeout = true;
        }

        if (hasTimeout)
        {
            yield return "ERROR: Timeout 10 minutos — verifica arduino-cli y el core esp32";
            yield return "RESULT:{\"success\":false,\"error\":\"Timeout 10 minutos\"}";
            yield break;
        }

        await process.WaitForExitAsync(CancellationToken.None);
        var exitCode = process.ExitCode;

        if (exitCode != 0)
        {
            yield return $"ERROR: Compilación fallida (exit code {exitCode})";
            yield return $"RESULT:{{\"success\":false,\"error\":\"Compilación fallida (exit code {exitCode})\"}}";
            yield break;
        }

        // Buscar .bin
        var binFiles = Directory.GetFiles(buildDir, "*.bin", SearchOption.AllDirectories);
        var binPath  = binFiles.FirstOrDefault();

        if (binPath == null)
        {
            yield return "ERROR: No se encontró el archivo .bin compilado";
            yield return "RESULT:{\"success\":false,\"error\":\"No se encontró .bin\"}";
            yield break;
        }

        var binData    = await File.ReadAllBytesAsync(binPath, CancellationToken.None);
        var b64        = Convert.ToBase64String(binData);
        var savedBin   = await SaveBinAsync(binData, safeProjectName);
        var escapedBin = EscapeJson(savedBin);

        yield return $"LOG: ✓ Compilación exitosa — {binData.Length:N0} bytes";
        yield return $"LOG: Guardado en {savedBin}";
        yield return $"RESULT:{{\"success\":true,\"binary\":\"{b64}\",\"binPath\":\"{escapedBin}\"}}";
    }

    private static async Task<string> SaveBinAsync(byte[] binData, string safeProjectName)
    {
        Directory.CreateDirectory(_proyectosDir);
        var destPath = Path.Combine(_proyectosDir, $"{safeProjectName}.bin");
        await File.WriteAllBytesAsync(destPath, binData);
        return destPath;
    }

    private static string EscapeJson(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "");
}
