using AutoGrading.Identity.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace AutoGrading.Identity.Api.Repository;

public class IdentityDbContext : DbContext
{
    public IdentityDbContext(DbContextOptions<IdentityDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<ClassLecturerCache> ClassLecturerCaches => Set<ClassLecturerCache>();
    public DbSet<SubmissionStudent> SubmissionStudents => Set<SubmissionStudent>();
    public DbSet<SubmissionGrader> SubmissionGraders => Set<SubmissionGrader>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Email).IsRequired().HasMaxLength(256);
            entity.HasIndex(u => u.Email).IsUnique();
            entity.Property(u => u.PasswordHash);
            entity.Property(u => u.GoogleSubjectId).HasMaxLength(64);
            entity.HasIndex(u => u.GoogleSubjectId).IsUnique().HasFilter("[GoogleSubjectId] IS NOT NULL");
            entity.Property(u => u.FullName).HasMaxLength(256);
            entity.Property(u => u.Role).HasConversion<string>().HasMaxLength(32);
            // StudentCode uniqueness is enforced in the application layer (UserService/AuthService via
            // IUserRepository.ExistsByStudentCodeAsync), not with a DB unique index: existing rows may
            // already contain duplicates from before this check existed, so a unique index migration
            // would risk failing against production data. Revisit once the data has been deduplicated.
            entity.Property(u => u.StudentCode).IsRequired(false).HasMaxLength(50);
            entity.Property(u => u.ClassId).IsRequired(false);
            entity.HasIndex(u => u.ClassId);
        });

        modelBuilder.Entity<ClassLecturerCache>(entity =>
        {
            entity.HasKey(c => c.ClassId);
            entity.Property(c => c.ClassName).IsRequired().HasMaxLength(256);
        });

        modelBuilder.Entity<SubmissionStudent>(entity =>
        {
            entity.HasKey(s => s.SubmissionId);
            entity.HasIndex(s => s.StudentId);
        });

        modelBuilder.Entity<SubmissionGrader>(entity =>
        {
            entity.HasKey(g => new { g.SubmissionId, g.LecturerId });
        });
    }
}
