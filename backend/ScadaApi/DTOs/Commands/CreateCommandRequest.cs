using System.Text.Json;

namespace ScadaApi.DTOs.Commands;

public record CreateCommandRequest(
    string      Tag,
    JsonElement Value,
    string?     Source
);
