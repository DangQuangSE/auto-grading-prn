import { useState } from "react";
import { Upload, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Field, SelectInput, TextInput } from "../components/ui/Field";
import { FormMessage } from "../components/ui/FormMessage";
import { Pagination } from "../components/ui/Pagination";
import { StateBlock } from "../components/ui/StateBlock";
import { useClasses } from "../hooks/useClasses";
import { useRosterUsers, useUpdateRosterUser } from "../hooks/useRoster";
import { ApiError } from "../lib/apiClient";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from "../lib/pagination";
import type { RosterUser } from "../services/rosterService";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return "You are not authorized to edit this student.";
    }
    if (error.status >= 500) {
      return "Something went wrong. Please try again.";
    }
    return error.message || "Request failed. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

function matchesFilter(text: string | null, query: string): boolean {
  return (text ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

export function RosterPage() {
  const [emailFilter, setEmailFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [mssvFilter, setMssvFilter] = useState("");
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [editingUser, setEditingUser] = useState<RosterUser | null>(null);
  const [studentCodeInput, setStudentCodeInput] = useState("");
  const [classIdInput, setClassIdInput] = useState("");
  const [duplicateMssvError, setDuplicateMssvError] = useState<string | null>(null);

  const users = useRosterUsers();
  const classes = useClasses();
  const updateUser = useUpdateRosterUser();

  const filtered = (users.data ?? []).filter(
    (user) =>
      user.role === "student" &&
      matchesFilter(user.email, emailFilter) &&
      matchesFilter(user.className, classFilter) &&
      matchesFilter(user.studentCode, mssvFilter),
  );

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleFilterChange(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value);
      setPage(DEFAULT_PAGE);
    };
  }

  function handlePageSizeChange(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPage(DEFAULT_PAGE);
  }

  function openEditModal(user: RosterUser) {
    setEditingUser(user);
    setStudentCodeInput(user.studentCode ?? "");
    setClassIdInput(user.classId ?? "");
  }

  function closeModal() {
    setEditingUser(null);
    setStudentCodeInput("");
    setClassIdInput("");
    setDuplicateMssvError(null);
    updateUser.reset();
  }

  async function handleSave() {
    if (!editingUser) {
      return;
    }

    setDuplicateMssvError(null);

    // Cheap client-side pre-check against the already-loaded roster list; the backend check on
    // the update endpoint remains the source of truth and is what actually enforces uniqueness.
    const normalizedCode = studentCodeInput.trim().toLowerCase();
    if (normalizedCode) {
      const isDuplicate = (users.data ?? []).some(
        (user) => user.id !== editingUser.id && (user.studentCode ?? "").trim().toLowerCase() === normalizedCode,
      );
      if (isDuplicate) {
        setDuplicateMssvError("MSSV already exists.");
        return;
      }
    }

    try {
      await updateUser.mutateAsync({
        userId: editingUser.id,
        studentCode: studentCodeInput,
        classId: classIdInput || undefined,
      });
      closeModal();
    } catch {
      // surfaced via updateUser.error below
    }
  }

  return (
    <section className="page-grid compact-page">
      <header className="page-header">
        <p>Roster</p>
        <h1>Student roster</h1>
        <Link to="/roster/import" className="secondary-button">
          <Upload aria-hidden="true" />
          Bulk import
        </Link>
      </header>
      <div className="table-panel">
        <div className="filter-bar">
          <Field label="Filter by email">
            <TextInput value={emailFilter} onChange={handleFilterChange(setEmailFilter)} placeholder="student@school.edu" />
          </Field>
          <Field label="Filter by MSSV">
            <TextInput value={mssvFilter} onChange={handleFilterChange(setMssvFilter)} placeholder="SE123456" />
          </Field>
          <Field label="Filter by class">
            <SelectInput value={classFilter} onChange={(e) => { setClassFilter(e.target.value); setPage(1); }}>
              <option value="">All classes</option>
              {(classes.data ?? []).map((klass) => (
                <option key={klass.id} value={klass.name}>
                  {klass.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        {users.isLoading ? <StateBlock title="Loading students" /> : null}
        {users.error ? <FormMessage tone="error">{describeError(users.error)}</FormMessage> : null}
        {users.data && totalCount === 0 ? (
          <StateBlock title="No students found" detail="Try adjusting the filters, or check back after students register." />
        ) : null}
        {pageItems.length > 0 ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Full name</th>
                  <th>MSSV</th>
                  <th>Class</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.fullName}</td>
                    <td>{user.studentCode || "-"}</td>
                    <td>{user.className || "-"}</td>
                    <td>
                      <Button type="button" variant="text" onClick={() => openEditModal(user)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              totalCount={totalCount}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        ) : null}
      </div>

      {editingUser ? (
        <div className="modal-overlay" role="presentation" onClick={closeModal}>
          <div
            className="modal-panel panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editingUser.email}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-panel-header">
              <h2>Edit student</h2>
              <Button type="button" variant="text" onClick={closeModal} aria-label="Close">
                <X aria-hidden="true" />
              </Button>
            </div>
            <p>{editingUser.email}</p>
            <Field label="MSSV">
              <TextInput
                value={studentCodeInput}
                onChange={(event) => {
                  setStudentCodeInput(event.target.value);
                  setDuplicateMssvError(null);
                }}
                placeholder="SE123456"
              />
            </Field>
            <Field label="Class">
              <SelectInput value={classIdInput} onChange={(event) => setClassIdInput(event.target.value)}>
                <option value="">{editingUser.className ? `Keep: ${editingUser.className}` : "No class"}</option>
                {(classes.data ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {duplicateMssvError ? <FormMessage tone="error">{duplicateMssvError}</FormMessage> : null}
            {!duplicateMssvError && updateUser.error ? <FormMessage tone="error">{describeError(updateUser.error)}</FormMessage> : null}
            <div className="modal-panel-actions">
              <Button type="button" onClick={handleSave} disabled={updateUser.isPending}>
                {updateUser.isPending ? "Saving..." : "Save"}
              </Button>
              <Button type="button" variant="secondary" onClick={closeModal} disabled={updateUser.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
