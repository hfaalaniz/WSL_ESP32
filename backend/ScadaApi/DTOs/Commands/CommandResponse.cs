namespace ScadaApi.DTOs.Commands;

public record CommandResponse(
    long      Id,
    string    Tag,
    object?   Value,
    string    Source,
    DateTime  CreatedAt,
    DateTime? ExecutedAt,
    bool      IsExecuted
);
