using ScadaApi.DTOs.Firmware;

namespace ScadaApi.Services;

public interface ICompilationService
{
    Task<CompilationResult> CompileAsync(CompileRequest request);
    IAsyncEnumerable<string> CompileStreamAsync(CompileRequest request, CancellationToken ct);
}
