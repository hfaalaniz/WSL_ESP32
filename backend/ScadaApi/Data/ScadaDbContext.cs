using Microsoft.EntityFrameworkCore;
using ScadaApi.Models;

namespace ScadaApi.Data;

public class ScadaDbContext : DbContext
{
    public ScadaDbContext(DbContextOptions<ScadaDbContext> options) : base(options) { }

    public DbSet<Device>          Devices          => Set<Device>();
    public DbSet<TelemetryRecord> TelemetryRecords => Set<TelemetryRecord>();
    public DbSet<AlarmRecord>     AlarmRecords     => Set<AlarmRecord>();
    public DbSet<ScadaProject>    ScadaProjects    => Set<ScadaProject>();
    public DbSet<PendingCommand>  PendingCommands  => Set<PendingCommand>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // ── Device ────────────────────────────────────────────────────────────
        mb.Entity<Device>(e =>
        {
            e.HasKey(d => d.Id);
            e.Property(d => d.Id).HasMaxLength(64);

            e.HasMany(d => d.TelemetryRecords)
             .WithOne(t => t.Device)
             .HasForeignKey(t => t.DeviceId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(d => d.AlarmRecords)
             .WithOne(a => a.Device)
             .HasForeignKey(a => a.DeviceId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(d => d.PendingCommands)
             .WithOne(c => c.Device)
             .HasForeignKey(c => c.DeviceId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // ── TelemetryRecord ───────────────────────────────────────────────────
        mb.Entity<TelemetryRecord>(e =>
        {
            // Índice compuesto para queries eficientes por tag e intervalo
            e.HasIndex(t => new { t.DeviceId, t.Tag, t.Timestamp });
            // Índice solo por timestamp para retención / purga
            e.HasIndex(t => t.Timestamp);
        });

        // ── AlarmRecord ───────────────────────────────────────────────────────
        mb.Entity<AlarmRecord>(e =>
        {
            e.HasIndex(a => new { a.DeviceId, a.TriggeredAt });
            e.HasIndex(a => a.IsActive);
        });

        // ── PendingCommand ────────────────────────────────────────────────────
        mb.Entity<PendingCommand>(e =>
        {
            e.HasIndex(c => new { c.DeviceId, c.ExecutedAt });
        });

        // ── ScadaProject ──────────────────────────────────────────────────────
        mb.Entity<ScadaProject>(e =>
        {
            e.Property(p => p.Content).HasColumnType("text");
        });
    }
}
