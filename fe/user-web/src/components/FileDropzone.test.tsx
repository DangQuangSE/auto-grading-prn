import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileDropzone } from "./FileDropzone";

describe("FileDropzone", () => {
  it("renders the label and accept hint when no file is selected", () => {
    render(<FileDropzone label="Report document" accept=".docx" file={null} onChange={vi.fn()} />);

    expect(screen.getByText("Report document")).toBeInTheDocument();
    expect(screen.getByText(".docx")).toBeInTheDocument();
  });

  it("shows the selected file's name instead of the accept hint", () => {
    const file = new File(["content"], "report.docx", { type: "application/vnd.openxmlformats" });
    render(<FileDropzone label="Report document" accept=".docx" file={file} onChange={vi.fn()} />);

    expect(screen.getByText("report.docx")).toBeInTheDocument();
    expect(screen.queryByText(".docx")).not.toBeInTheDocument();
  });

  it("sets the accept attribute on the underlying file input", () => {
    render(<FileDropzone label="Diagram" accept=".drawio" file={null} onChange={vi.fn()} />);

    const input = screen.getByLabelText("Diagram", { exact: false }) as HTMLInputElement;
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".drawio");
  });

  it("calls onChange with the selected file", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FileDropzone label="Report document" accept=".docx" file={null} onChange={onChange} />);

    const file = new File(["content"], "report.docx");
    const input = screen.getByLabelText("Report document", { exact: false }) as HTMLInputElement;

    await user.upload(input, file);

    expect(onChange).toHaveBeenCalledWith(file);
  });

  it("calls onChange with null when the file selection is cleared", () => {
    const onChange = vi.fn();
    render(<FileDropzone label="Report document" accept=".docx" file={null} onChange={onChange} />);

    const input = screen.getByLabelText("Report document", { exact: false }) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
